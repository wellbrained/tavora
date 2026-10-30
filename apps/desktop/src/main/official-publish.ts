import { createHash, type KeyObject } from "node:crypto";
import { execFile } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { isModuleId, validateManifest } from "@tavora/module-schema";
import { fingerprint, loadExistingKey, packModule, PackError, type Published } from "@tavora/pack";
import { compareModuleVersions } from "../shared/module-version";
import { UserError } from "./messages";
import { OFFICIAL_PREFIX } from "./registry";

// The dev build's publish button for a built-in module (Settings > Development, dev builds only). Tavora's own modules
// update from the catalogue only when signed by the pinned Tavora key, so this is where that signing happens. It builds
// nothing from the working folder: the module is built in a fresh temporary worktree at origin/main, CI must be green
// for that commit, the version must be newer than the catalogue's and than the module in the last app release, and it
// refuses when anything the module runs on (the app's host code, the SDK, the manifest schema, the UI kit) changed since
// that release, because the shipped app could not run it. The key file is read for this one upload and kept nowhere.

/** Where Tavora's repository is on GitHub, for the CI check. */
export const GITHUB_REPO = "wellbrained/tavora";

/** What the module runs on: when any of it changed since the last release, the shipped app is not what the module was built for. */
export const HOST_PATHS = ["apps/desktop/src", "packages/sdk", "packages/module-schema", "modules/shared"] as const;

/** The branch every update is built from. */
const BRANCH = "main";

export interface RunOptions {
  cwd: string;
  /** Milliseconds before the command is stopped. */
  timeoutMs?: number;
}

/** Runs a program with its arguments (no shell parsing of them) and answers with its output; rejects when it fails. */
export type Run = (command: string, args: readonly string[], options: RunOptions) => Promise<string>;

const execute = promisify(execFile);

/** The real runner. On Windows pnpm and gh are `.cmd` files, which need a shell; the arguments are fixed words or checked ids. */
export const runCommand: Run = async (command, args, { cwd, timeoutMs = 600_000 }) => {
  try {
    const { stdout } = await execute(command, [...args], { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, shell: process.platform === "win32", windowsHide: true });
    return stdout;
  } catch (error) {
    const failure = error as { stderr?: string; message: string };
    throw new Error(`${command} ${args[0] ?? ""} failed: ${(failure.stderr || failure.message).trim().slice(0, 500)}`);
  }
};

export interface OfficialPublisherOptions {
  /** The repository checkout this dev Tavora runs from. */
  repo: string;
  userData: string;
  run?: Run;
  /** What the catalogue lists as newest for an id, or null; throws when it can't be asked. */
  listed: (id: string) => Promise<{ version: string } | null>;
  /** Whether a key may sign Tavora's own modules, for this zip (official-updates.ts). */
  trusted: (fingerprint: string, sha256: string) => boolean;
  /** Uploads a signed zip with the account's sign-in (never a publish token). */
  upload: (key: KeyObject, zip: Buffer) => Promise<Published>;
  now?: () => number;
}

export interface OfficialPublished {
  id: string;
  version: string;
  sha256: string;
  /** The commit it was built from. */
  commit: string;
}

export class OfficialPublisher {
  private readonly run: Run;
  private busy = false;

  constructor(private readonly options: OfficialPublisherOptions) {
    this.run = options.run ?? runCommand;
  }

  /** Builds `moduleId` from origin/main, signs it with the key file and uploads it. Every refusal is a UserError. */
  async publish(moduleId: string, keyFile: string): Promise<OfficialPublished> {
    if (this.busy) throw new UserError("officialPublish.error.busy");
    if (!isModuleId(moduleId) || !moduleId.startsWith(OFFICIAL_PREFIX)) throw new UserError("officialPublish.error.notBuiltIn");
    this.busy = true;
    let worktree: string | undefined;
    try {
      // Read for this one upload; nothing below stores it, and it is gone when this function returns.
      const key = await loadExistingKey(path.resolve(keyFile)).then(
        ({ key: loaded }) => loaded,
        (error: unknown) => {
          throw new UserError("officialPublish.error.key", { message: (error as Error).message.replace(/There is no publisher key at .*/, "there is no key file there") });
        },
      );
      const signer = fingerprint(key);
      const { repo } = this.options;
      const git = (...args: string[]) => this.run("git", args, { cwd: repo, timeoutMs: 120_000 }).then((out) => out.trim());

      await git("fetch", "origin", BRANCH, "--tags", "--quiet").catch(() => {
        throw new UserError("officialPublish.error.fetch");
      });
      const commit = await git("rev-parse", `origin/${BRANCH}`);
      const release = await this.lastRelease(git);
      const folder = await this.moduleFolder(git, commit, moduleId);

      // Anything the module runs on that changed since the last release means the shipped app can't run this build yet.
      const changed = await git("diff", "--name-only", release, commit, "--", ...HOST_PATHS);
      if (changed) throw new UserError("officialPublish.error.waitForRelease");

      await this.requireGreen(commit);

      worktree = await mkdtemp(path.join(tmpdir(), "tavora-official-publish-"));
      await git("worktree", "add", "--detach", worktree, commit);
      const moduleDir = path.join(worktree, folder);
      const manifest = await this.readManifest(moduleDir, moduleId);

      // Newer than the catalogue, and than the module in the app people have.
      const listed = await this.options.listed(moduleId).catch(() => {
        throw new UserError("officialPublish.error.catalogue");
      });
      if (listed && compareModuleVersions(manifest.version, listed.version) <= 0) throw new UserError("officialPublish.error.notNewer", { version: manifest.version, other: listed.version });
      const shipped = await this.shippedVersion(git, release, folder);
      if (shipped && compareModuleVersions(manifest.version, shipped) <= 0) throw new UserError("officialPublish.error.notNewer", { version: manifest.version, other: shipped });

      await this.build(worktree, moduleDir);
      // The oldest Tavora that runs it: the app release it was built against.
      await this.setMinTavora(moduleDir, release.replace(/^v/, ""));
      const { zip } = await packModule(moduleDir, key).catch((error: unknown) => {
        if (error instanceof PackError) throw new UserError("officialPublish.error.pack", { message: error.message });
        throw error;
      });
      const sha256 = createHash("sha256").update(zip).digest("hex");
      if (!this.options.trusted(signer, sha256)) throw new UserError("officialPublish.error.wrongKey");

      const published = await this.options.upload(key, zip);
      const result = { id: published.id, version: published.version, sha256: published.sha256, commit };
      await appendFile(path.join(this.options.userData, "official-publishes.log"), `${JSON.stringify({ ...result, at: new Date(this.options.now?.() ?? Date.now()).toISOString() })}\n`).catch(() => undefined);
      return result;
    } finally {
      this.busy = false;
      if (worktree) {
        await this.run("git", ["worktree", "remove", "--force", worktree], { cwd: this.options.repo, timeoutMs: 60_000 }).catch(() => undefined);
        await rm(worktree, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  /** The newest release tag (v0.23.0 …). */
  private async lastRelease(git: (...args: string[]) => Promise<string>): Promise<string> {
    const tags = (await git("tag", "--list", "v*", "--sort=-v:refname")).split(/\r?\n/).filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
    if (!tags[0]) throw new UserError("officialPublish.error.noRelease");
    return tags[0];
  }

  /** The folder under modules/ whose manifest at `commit` has this id. */
  private async moduleFolder(git: (...args: string[]) => Promise<string>, commit: string, id: string): Promise<string> {
    const folders = (await git("ls-tree", "--name-only", commit, "modules/")).split(/\r?\n/).filter((entry) => /^modules\/[a-z0-9._-]+$/.test(entry));
    for (const folder of folders) {
      const text = await git("show", `${commit}:${folder}/tavora.module.json`).catch(() => "");
      try {
        if ((JSON.parse(text) as { id?: unknown }).id === id) return folder;
      } catch {
        // Not a module folder.
      }
    }
    throw new UserError("officialPublish.error.notBuiltIn");
  }

  /** The version the module has in the last release, or null when it was not in it. */
  private async shippedVersion(git: (...args: string[]) => Promise<string>, release: string, folder: string): Promise<string | null> {
    const text = await git("show", `${release}:${folder}/tavora.module.json`).catch(() => "");
    try {
      const version = (JSON.parse(text) as { version?: unknown }).version;
      return typeof version === "string" ? version : null;
    } catch {
      return null;
    }
  }

  /** CI for that exact commit finished and every check passed. */
  private async requireGreen(commit: string): Promise<void> {
    let answer: string;
    try {
      answer = await this.run("gh", ["api", `repos/${GITHUB_REPO}/commits/${commit}/check-runs?per_page=100`], { cwd: this.options.repo, timeoutMs: 60_000 });
    } catch {
      throw new UserError("officialPublish.error.ci");
    }
    let runs: { status?: unknown; conclusion?: unknown }[];
    try {
      runs = (JSON.parse(answer) as { check_runs?: typeof runs }).check_runs ?? [];
    } catch {
      throw new UserError("officialPublish.error.ci");
    }
    const green = runs.length > 0 && runs.every((item) => item.status === "completed" && (item.conclusion === "success" || item.conclusion === "skipped" || item.conclusion === "neutral"));
    if (!green) throw new UserError("officialPublish.error.ciNotGreen");
  }

  private async readManifest(moduleDir: string, id: string) {
    const result = validateManifest(JSON.parse(await readFile(path.join(moduleDir, "tavora.module.json"), "utf8")));
    if (!result.ok || result.manifest.id !== id) throw new UserError("officialPublish.error.notBuiltIn");
    return result.manifest;
  }

  /** A clean install from the lockfile and a build of the module, in the temporary worktree. */
  private async build(worktree: string, moduleDir: string): Promise<void> {
    const pkg = JSON.parse(await readFile(path.join(moduleDir, "package.json"), "utf8")) as { name?: unknown };
    // The name goes to a command line; only the characters of a package name pass.
    if (typeof pkg.name !== "string" || !/^@?[a-z0-9][a-z0-9._/-]*$/.test(pkg.name)) throw new UserError("officialPublish.error.notBuiltIn");
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    try {
      await this.run(pnpm, ["install", "--frozen-lockfile"], { cwd: worktree });
      await this.run(pnpm, ["--filter", `${pkg.name}...`, "build"], { cwd: worktree });
    } catch (error) {
      throw new UserError("officialPublish.error.build", { message: (error as Error).message });
    }
  }

  /** Writes minTavora into the built copy's manifest; the file in the worktree only, never in the repo. */
  private async setMinTavora(moduleDir: string, version: string): Promise<void> {
    const file = path.join(moduleDir, "tavora.module.json");
    const text = await readFile(file, "utf8");
    const manifest = JSON.parse(text) as Record<string, unknown>;
    const current = typeof manifest.minTavora === "string" ? manifest.minTavora : null;
    manifest.minTavora = current && compareModuleVersions(current, version) > 0 ? current : version;
    await writeFile(file, `${JSON.stringify(manifest, null, /^([ \t]+)"/m.exec(text)?.[1] ?? "  ")}\n`);
  }
}
