import { createHash, type KeyObject } from "node:crypto";
import { execFile } from "node:child_process";
import { appendFile, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isModuleId, validateChangelog, validateManifest } from "@tavora/module-schema";
import { collectFiles, fingerprint, packModule, PackError, readZip, SIGNATURE_FILE, type Published } from "@tavora/pack";
import type { OfficialPublishOverview, OfficialPublishPreview, OfficialPublishRow, OfficialPublishStep } from "../shared/host-api";
import { compareModuleVersions } from "../shared/module-version";
import { UserError } from "./messages";
import { BROWSER_MODULE_ID, OFFICIAL_PREFIX } from "./registry";

// The dev build's publish flow for a built-in module (Settings > Development, dev builds only). Tavora's own modules
// update from the catalogue only when signed by the pinned Tavora key, so this is where that signing happens. It builds
// nothing from the working folder: the module is built in a fresh temporary worktree at origin/main, CI must be green
// for that commit, the version must be newer than the catalogue's and than the module in the last app release, and it
// refuses when the host code modules run on (the SDK, the manifest schema, the module-facing part of the main process and
// the module preload; see blockingChanges) changed since that release, because the shipped app could not run it. The flow has two halves: prepare (build and pack, shown as a
// preview) and finish (sign with the key the host hands in and upload exactly what the preview showed). The key is
// never read or kept here; the host loads it for finish and drops it.

/** Where Tavora's repository is on GitHub, for the CI check. */
export const GITHUB_REPO = "wellbrained/tavora";

/** The branch every update is built from. */
const BRANCH = "main";

const APP = "apps/desktop/src";
/** The module protocol, the manifest rules and the zip and signature format: any source change here means the shipped app may not understand the module. */
export const PROTOCOL_PATHS = ["packages/sdk/src", "packages/module-schema/src", "packages/pack/src"] as const;
/** What this dev Tavora itself uses to check, pack and sign: it must be the released code, or the zip may not be one the shipped app accepts. */
export const SIGNING_PATHS = ["packages/pack/src", "packages/module-schema/src"] as const;
/** The host code: the main process and the preloads. Every file in it blocks, except the host-window-only ones below that no module-facing code loads. */
export const HOST_PATHS = [`${APP}/main`, `${APP}/preload`] as const;
/** Shared code: it counts when module-facing host code loads it (import graph), not when only the renderer or the host window does. */
export const SHARED_PATH = `${APP}/shared`;
/** Text tables for the host's own screens. A changed word can't make a module need host behaviour the shipped app lacks. */
const TEXT_TABLES = `${SHARED_PATH}/locales/`;

/**
 * Host files that only the host window uses: onboarding and the Add a game list, game detection, the catalogue client for
 * the app's own pages, the account, the cloud copy and publishing screens, the host window's preload, and the files that
 * start the app and wire these together. A change in one of them can't change what a module sees or does.
 * Nothing else is listed (a file not listed blocks, so a new file is safe until someone decides), and a listed file still
 * blocks when module-facing code imports it (moduleFacingFiles).
 * `host.ts` also hands the bridge its callbacks (menus, saving, links); the module-facing behaviour behind them is in the
 * files it calls (module-view.ts, bridge.ts and the services), which block. The wiring itself is the one thing this can't see.
 */
export const HOST_ONLY: ReadonlySet<string> = new Set(
  [
    "main/index.ts",
    "main/host.ts",
    "main/startup-failure.ts",
    "main/actions.ts",
    "main/games-seen.ts",
    "main/steam-played.ts",
    "main/installed-list.ts",
    "main/launcher-games.ts",
    "main/game-watch.ts",
    "main/steam-import.ts",
    "main/steam-appinfo.ts",
    "main/steam-shortcuts.ts",
    "main/pe-icon.ts",
    "main/hosted-icons.ts",
    "main/icon-sync.ts",
    "main/share-icons.ts",
    "main/catalog-client.ts",
    "main/catalog-readme.ts",
    "main/module-page.ts",
    "main/publisher-names.ts",
    "main/account.ts",
    "main/account-key.ts",
    "main/sign-in.ts",
    "main/pairing.ts",
    "main/developer-keys.ts",
    "main/device-name.ts",
    "main/inbox.ts",
    "main/example-copy.ts",
    "main/cloud-copy.ts",
    "main/cloud-copy-sync.ts",
    "main/copy-crypto.ts",
    "main/copy-folder.ts",
    // The publish tooling itself (this file, its key store and the module publish button).
    "main/official-publish.ts",
    "main/official-key-store.ts",
    "main/module-publish.ts",
    // The host window's preload; module pages load module.ts.
    "preload/host.ts",
  ].map((file) => `${APP}/${file}`),
);

/** Built-in ids that never go to the catalogue: the Browser is a host panel and the Playground a developer specimen. */
export const NEVER_PUBLISHED: ReadonlySet<string> = new Set([BROWSER_MODULE_ID, "tavora.playground"]);

/** Temporary worktrees are made with this prefix, so a later run can find and remove one left behind. */
export const WORKTREE_PREFIX = "tavora-publish-worktree-";
/** A worktree left behind is swept once it is this old, so a run in progress (another dev Tavora) is never touched. */
const STALE_WORKTREE_MS = 60 * 60 * 1000;

export interface RunOptions {
  cwd: string;
  /** Milliseconds before the command is stopped. */
  timeoutMs?: number;
  /** Stops the command (and on Windows its whole process tree) when aborted. */
  signal?: AbortSignal | undefined;
}

/** Runs a program with its arguments (no shell parsing of them) and answers with its output; rejects when it fails. */
export type Run = (command: string, args: readonly string[], options: RunOptions) => Promise<string>;

/** The real runner. On Windows pnpm is a `.cmd` file, which needs a shell; its arguments are fixed words or a checked name. Everything else runs without one. */
export const runCommand: Run = (command, args, { cwd, timeoutMs = 600_000, signal }) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new PublishCancelled());
    const windows = process.platform === "win32";
    const shell = windows && command.endsWith(".cmd");
    let timedOut = false;
    // Elsewhere the command leads its own process group, so stop() reaches what it started too.
    // execFile hands `detached` on to spawn; its types just don't list it.
    const options = { cwd, encoding: "utf8" as const, maxBuffer: 32 * 1024 * 1024, shell, windowsHide: true, detached: !windows };
    const child = execFile(command, [...args], options, (error, stdout, stderr) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      if (signal?.aborted) return reject(new PublishCancelled());
      if (!error) return resolve(stdout);
      const why = timedOut ? "took too long" : (stderr || error.message).trim().slice(0, 500);
      reject(new Error(`${command} ${args[0] ?? ""} failed: ${why}`));
    });
    // Ends the whole tree: killing only a shell (Windows) or the leader (elsewhere) leaves pnpm and its builds running.
    function stop() {
      if (!child.pid) return;
      if (windows) execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => undefined);
      else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill();
        }
      }
    }
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    signal?.addEventListener("abort", stop, { once: true });
  });

/** The run was cancelled by the user; nothing to report. */
export class PublishCancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

/** A test file, which never runs in the shipped app. */
export function isTestFile(file: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$|\.test-helper\.ts$|\.fixture\.ts$|(^|\/)__tests__\//.test(file);
}

/** Relative imports in `git grep` lines (`<rev>:<path>:<text>`): from, import, export … from and import(). */
const IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;

/** An import or re-export that brings in types only: it is gone from the built code, so it loads nothing. */
function isTypeOnly(text: string): boolean {
  if (/^\s*(?:import|export)\s+type\b/.test(text)) return true;
  const named = /^\s*(?:import|export)\s*\{([^}]*)\}\s*from\b/.exec(text);
  const names = named ? named[1]!.split(",").map((name) => name.trim()).filter(Boolean) : [];
  return names.length > 0 && names.every((name) => name.startsWith("type "));
}

const isHostFile = (file: string) => HOST_PATHS.some((root) => file.startsWith(`${root}/`));

/**
 * The files module-facing host code loads at one commit. Every non-test main or preload file that is not host-window-only
 * is a start; what it imports at run time, directly or through other files, comes with it (host-only and shared files
 * too). `grep` is `git grep` output over main, preload and shared; `files` lists every file there at that commit.
 * Type-only imports don't count (they are gone from the built code), and tests never do.
 */
export function moduleFacingFiles(grep: string, files: readonly string[]): Set<string> {
  const known = new Set(files);
  const imports = new Map<string, Set<string>>();
  for (const line of grep.split(/\r?\n/)) {
    // `<rev>:<path>:<text>`; paths have no colon.
    const match = /^[^:]+:([^:]+):(.*)$/.exec(line);
    if (!match) continue;
    const [, file, text] = match as unknown as [string, string, string];
    const found = [...text.matchAll(IMPORT)];
    // Only a line with a single import can be told apart as type-only; anything odder counts.
    if (found.length === 1 && isTypeOnly(text)) continue;
    for (const one of found) {
      const target = resolveImport(file, one[1]!, known);
      if (target) imports.set(file, (imports.get(file) ?? new Set()).add(target));
    }
  }
  const queue = files.filter((file) => isHostFile(file) && !HOST_ONLY.has(file) && !isTestFile(file));
  const reached = new Set(queue);
  while (queue.length) {
    const file = queue.pop()!;
    for (const next of imports.get(file) ?? []) {
      if (reached.has(next) || isTestFile(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return reached;
}

function resolveImport(from: string, spec: string, known: ReadonlySet<string>): string | null {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  for (const candidate of [base, `${base}.ts`, base.replace(/\.[cm]?js$/, ".ts"), `${base}/index.ts`]) if (known.has(candidate)) return candidate;
  return null;
}

/** Whether a changed file needs the import graph to be judged: a host-window-only file, or a shared file that isn't a text table. */
const needsGraph = (file: string) => !isTestFile(file) && (HOST_ONLY.has(file) || (file.startsWith(`${SHARED_PATH}/`) && !file.startsWith(TEXT_TABLES)));

/**
 * Of the files changed since the last release, those the shipped app runs modules on; empty when a module update can go out.
 * `moduleFacing` is moduleFacingFiles for the new commit. Blocking: the SDK, schema and pack sources; any main or preload
 * file that isn't host-window-only (the safe default for a file nobody has sorted); a host-only or shared file that
 * module-facing code loads. Never: tests, the renderer, text tables, host-window-only files nothing module-facing loads.
 */
export function blockingChanges(changed: readonly string[], moduleFacing: ReadonlySet<string>): string[] {
  return changed.filter((file) => {
    if (isTestFile(file)) return false;
    if (PROTOCOL_PATHS.some((root) => file.startsWith(`${root}/`))) return true;
    if (isHostFile(file)) return !HOST_ONLY.has(file) || moduleFacing.has(file);
    if (file.startsWith(TEXT_TABLES)) return false;
    return moduleFacing.has(file);
  });
}

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
  /** Where temporary worktrees go (the system's temp folder). */
  temp?: string;
}

export interface OfficialPublished {
  id: string;
  version: string;
  sha256: string;
  /** The commit it was built from. */
  commit: string;
}

/** A module folder on main with its version there and in the last release. */
interface Candidate {
  id: string;
  name: string;
  folder: string;
  version: string;
  shipped: string;
}

/** What the last release and origin/main are, after a fetch. */
interface Head {
  commit: string;
  release: string;
}

interface Prepared {
  worktree: string;
  moduleDir: string;
  commit: string;
  preview: OfficialPublishPreview;
  /** SHA-256 of each file the preview showed, by name: the zip must hold exactly these. */
  hashes: Map<string, string>;
}

type Git = (...args: string[]) => Promise<string>;

export class OfficialPublisher {
  private readonly run: Run;
  private busy = false;
  /** Signing or uploading: nothing can stop it now. */
  private finishing = false;
  private prepared: Prepared | null = null;
  private abort: AbortController | null = null;

  constructor(private readonly options: OfficialPublisherOptions) {
    this.run = options.run ?? runCommand;
  }

  /** The built-in modules with a newer version on main than in the last release, each with what stands in its way. */
  async check(): Promise<OfficialPublishOverview> {
    const git = this.git();
    const head = await this.head(git);
    const candidates = (await this.candidates(git, head)).filter((item) => compareModuleVersions(item.version, item.shipped) > 0);
    if (!candidates.length) return { ...head, rows: [], hostChanges: [] };
    const hostChanges = await this.hostChanges(git, head);
    const ci = await this.ciState(head.commit, undefined);
    const rows = await Promise.all(
      candidates.map(async (item): Promise<OfficialPublishRow> => {
        const listed = (await this.listed(item.id))?.version ?? null;
        const order = listed === null ? 1 : compareModuleVersions(item.version, listed);
        const status = order === 0 ? "published" : order < 0 ? "catalogueNewer" : hostChanges.length ? "waitForRelease" : ci === "failed" ? "ciFailed" : ci === "pending" ? "ciPending" : "ready";
        return { id: item.id, name: item.name, version: item.version, shipped: item.shipped, listed, status };
      }),
    );
    return { ...head, rows: rows.sort((a, b) => a.name.localeCompare(b.name)), hostChanges: hostChanges.slice(0, 20) };
  }

  /**
   * Builds `moduleId` from origin/main in a temporary worktree and packs it, without a key: the preview of what finish
   * signs and uploads. Every refusal is a UserError; cancel() ends it with PublishCancelled.
   */
  async prepare(moduleId: string, onStep: (step: OfficialPublishStep) => void = () => undefined): Promise<OfficialPublishPreview> {
    if (this.busy || this.prepared) throw new UserError("officialPublish.error.busy");
    if (!isModuleId(moduleId) || !moduleId.startsWith(OFFICIAL_PREFIX) || NEVER_PUBLISHED.has(moduleId)) throw new UserError("officialPublish.error.notBuiltIn");
    this.busy = true;
    const abort = (this.abort = new AbortController());
    const step = (name: OfficialPublishStep) => {
      if (abort.signal.aborted) throw new PublishCancelled();
      onStep(name);
    };
    let worktree: string | undefined;
    try {
      step("fetch");
      const git = this.git(abort.signal);
      await this.sweep();
      const head = await this.head(git);

      step("check");
      // This dev Tavora packs and signs with its own copy of the pack code and the manifest rules.
      const local = (await git("diff", "--name-only", head.release, "--", ...SIGNING_PATHS)).split(/\r?\n/).filter((file) => file && !isTestFile(file));
      if (local.length) throw new UserError("officialPublish.error.localPack");
      const item = (await this.candidates(git, head)).find((candidate) => candidate.id === moduleId);
      if (!item) throw new UserError("officialPublish.error.notBuiltIn");
      // Newer than the module in the app people have, and than the catalogue.
      if (compareModuleVersions(item.version, item.shipped) <= 0) throw new UserError("officialPublish.error.notNewer", { version: item.version, other: item.shipped });
      const listed = (await this.listed(moduleId))?.version ?? null;
      if (listed && compareModuleVersions(item.version, listed) <= 0) throw new UserError("officialPublish.error.notNewer", { version: item.version, other: listed });
      // Host code that changed since the release means the shipped app can't run this build yet.
      if ((await this.hostChanges(git, head)).length) throw new UserError("officialPublish.error.waitForRelease");
      const ci = await this.ciState(head.commit, abort.signal);
      if (ci !== "green") throw new UserError("officialPublish.error.ciNotGreen");

      step("worktree");
      worktree = await mkdtemp(path.join(this.temp(), WORKTREE_PREFIX));
      await git("worktree", "add", "--detach", worktree, head.commit);
      const moduleDir = path.join(worktree, item.folder);
      const manifest = await this.readManifest(moduleDir, moduleId);
      if (manifest.version !== item.version) throw new UserError("officialPublish.error.notBuiltIn");

      await this.build(worktree, moduleDir, step, abort.signal);
      // The oldest Tavora that runs it: the app release it was built against.
      const minTavora = await this.setMinTavora(moduleDir, head.release.replace(/^v/, ""));

      step("pack");
      const { files } = await collectFiles(moduleDir).catch((error: unknown) => {
        if (error instanceof PackError) throw new UserError("officialPublish.error.pack", { message: error.message });
        throw error;
      });
      const preview: OfficialPublishPreview = {
        id: moduleId,
        name: item.name,
        version: item.version,
        shipped: item.shipped,
        listed,
        commit: head.commit,
        release: head.release,
        minTavora,
        notes: await this.notes(moduleDir, manifest.changelog, item.version),
        files: files.map((file) => ({ name: file.name, size: file.data.length })),
        size: files.reduce((sum, file) => sum + file.data.length, 0),
      };
      if (abort.signal.aborted) throw new PublishCancelled();
      this.prepared = { worktree, moduleDir, commit: head.commit, preview, hashes: new Map(files.map((file) => [file.name, sha256Of(file.data)])) };
      worktree = undefined;
      return preview;
    } catch (error) {
      if (abort.signal.aborted) throw new PublishCancelled();
      throw error;
    } finally {
      this.busy = false;
      this.abort = null;
      if (worktree) await this.removeWorktree(worktree);
    }
  }

  /** The prepared build's preview, or null. */
  get preview(): OfficialPublishPreview | null {
    return this.prepared?.preview ?? null;
  }

  /**
   * Signs the prepared build with `key` and uploads it. The zip must hold exactly the files the preview showed. A key
   * that may not sign Tavora's modules is refused and the build stays prepared, so another key can be tried.
   */
  async finish(key: KeyObject, onStep: (step: OfficialPublishStep) => void = () => undefined): Promise<OfficialPublished> {
    const prepared = this.prepared;
    if (!prepared || this.busy) throw new UserError("officialPublish.error.notPrepared");
    this.busy = true;
    this.finishing = true;
    let done = false;
    try {
      onStep("sign");
      const { zip } = await packModule(prepared.moduleDir, key).catch((error: unknown) => {
        if (error instanceof PackError) throw new UserError("officialPublish.error.pack", { message: error.message });
        throw error;
      });
      const sha256 = createHash("sha256").update(zip).digest("hex");
      if (!this.options.trusted(fingerprint(key), sha256)) throw new UserError("officialPublish.error.wrongKey");
      // What goes up is what the preview showed: same names, same sizes, nothing added.
      const packed = readZip(zip).filter((file) => file.name !== SIGNATURE_FILE);
      const shown = prepared.preview.files;
      if (packed.length !== shown.length || packed.some((file, index) => file.name !== shown[index]!.name || prepared.hashes.get(file.name) !== sha256Of(file.data))) {
        done = true;
        throw new UserError("officialPublish.error.changed");
      }
      // The catalogue may have moved on while the preview was open.
      const listed = (await this.listed(prepared.preview.id))?.version ?? null;
      if (listed && compareModuleVersions(prepared.preview.version, listed) <= 0) {
        done = true;
        throw new UserError("officialPublish.error.notNewer", { version: prepared.preview.version, other: listed });
      }

      onStep("upload");
      const published = await this.options.upload(key, zip);
      done = true;
      const result = { id: published.id, version: published.version, sha256: published.sha256, commit: prepared.commit };
      await appendFile(path.join(this.options.userData, "official-publishes.log"), `${JSON.stringify({ ...result, at: new Date(this.options.now?.() ?? Date.now()).toISOString() })}\n`).catch(() => undefined);
      return result;
    } finally {
      this.busy = false;
      this.finishing = false;
      if (done) await this.discard();
    }
  }

  /** Signing or uploading right now: Cancel can't stop that. */
  get uploading(): boolean {
    return this.finishing;
  }

  /** Stops a prepare in progress, or throws away a prepared build. */
  async cancel(): Promise<void> {
    if (this.finishing) return;
    this.abort?.abort();
    if (!this.busy) await this.discard();
  }

  private async discard(): Promise<void> {
    const prepared = this.prepared;
    this.prepared = null;
    if (prepared) await this.removeWorktree(prepared.worktree);
  }

  /** Removes worktrees an earlier run left behind (a crash, a quit with a preview open), and git's note of them. */
  async sweep(): Promise<void> {
    const temp = this.temp();
    const now = this.options.now?.() ?? Date.now();
    const entries = await readdir(temp).catch(() => [] as string[]);
    for (const name of entries) {
      if (!name.startsWith(WORKTREE_PREFIX)) continue;
      const full = path.join(temp, name);
      if (full === this.prepared?.worktree) continue;
      const info = await stat(full).catch(() => null);
      if (info && now - info.mtimeMs > STALE_WORKTREE_MS) await removeFolder(full);
    }
    await this.run("git", ["worktree", "prune"], { cwd: this.options.repo, timeoutMs: 60_000 }).catch(() => undefined);
  }

  private async removeWorktree(worktree: string): Promise<void> {
    await this.run("git", ["worktree", "remove", "--force", worktree], { cwd: this.options.repo, timeoutMs: 120_000 }).catch(() => undefined);
    // git leaves what it doesn't track (node_modules) when it can't delete it; Windows may hold a file a moment longer.
    await removeFolder(worktree);
    await this.run("git", ["worktree", "prune"], { cwd: this.options.repo, timeoutMs: 60_000 }).catch(() => undefined);
  }

  private temp(): string {
    return this.options.temp ?? tmpdir();
  }

  private git(signal?: AbortSignal): Git {
    return (...args: string[]) => this.run("git", args, { cwd: this.options.repo, timeoutMs: 120_000, signal }).then((out) => out.trim());
  }

  private async listed(id: string): Promise<{ version: string } | null> {
    try {
      return await this.options.listed(id);
    } catch {
      throw new UserError("officialPublish.error.catalogue");
    }
  }

  /** Fetches main and the tags; the commit of origin/main and the newest release tag (v0.23.0 …). */
  private async head(git: Git): Promise<Head> {
    await git("fetch", "origin", BRANCH, "--tags", "--quiet").catch((error: unknown) => {
      if (error instanceof PublishCancelled) throw error;
      throw new UserError("officialPublish.error.fetch");
    });
    const commit = await git("rev-parse", `origin/${BRANCH}`);
    const tags = (await git("tag", "--list", "v*", "--merged", `origin/${BRANCH}`, "--sort=-v:refname")).split(/\r?\n/).filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
    if (!tags[0]) throw new UserError("officialPublish.error.noRelease");
    return { commit, release: tags[0] };
  }

  /** Every built-in module folder on main that may be published and was in the last release. */
  private async candidates(git: Git, { commit, release }: Head): Promise<Candidate[]> {
    const folders = (await git("ls-tree", "--name-only", commit, "modules/")).split(/\r?\n/).filter((entry) => /^modules\/[a-z0-9._-]+$/.test(entry));
    const found: Candidate[] = [];
    for (const folder of folders) {
      const now = await this.manifestAt(git, commit, folder);
      if (!now || !now.id.startsWith(OFFICIAL_PREFIX) || NEVER_PUBLISHED.has(now.id)) continue;
      const then = await this.manifestAt(git, release, folder);
      // Only a module the app ships can update; one new since the release goes out with the next one.
      if (!then || then.id !== now.id) continue;
      found.push({ id: now.id, name: now.name, folder, version: now.version, shipped: then.version });
    }
    return found;
  }

  private async manifestAt(git: Git, rev: string, folder: string): Promise<{ id: string; name: string; version: string } | null> {
    const text = await git("show", `${rev}:${folder}/tavora.module.json`).catch((error: unknown) => {
      if (error instanceof PublishCancelled) throw error;
      return "";
    });
    try {
      const { id, name, version } = JSON.parse(text) as { id?: unknown; name?: unknown; version?: unknown };
      if (typeof id !== "string" || !isModuleId(id) || typeof version !== "string") return null;
      return { id, name: typeof name === "string" ? name : id, version };
    } catch {
      return null;
    }
  }

  /** The files changed since the release that the shipped app runs modules on (blockingChanges). */
  private async hostChanges(git: Git, { commit, release }: Head): Promise<string[]> {
    const changed = (await git("diff", "--name-only", release, commit, "--", ...PROTOCOL_PATHS, ...HOST_PATHS, SHARED_PATH)).split(/\r?\n/).filter(Boolean);
    if (!changed.length) return [];
    // Only a host-window-only or shared file needs the import graph; the rest is judged by its path.
    if (!changed.some(needsGraph)) return blockingChanges(changed, new Set());
    const files = (await git("ls-tree", "-r", "--name-only", commit, "--", ...HOST_PATHS, SHARED_PATH)).split(/\r?\n/).filter(Boolean);
    // Plain output whatever git is set to; a failure refuses, since counting nothing would let host changes through.
    // (git grep also exits 1 when nothing matches; main always imports shared code, so that never happens here.)
    const grep = await git("-c", "color.ui=never", "-c", "core.quotePath=false", "grep", "--no-color", "-I", "-E", "-e", "(from|import)[[:space:]]*\\(?[[:space:]]*[\"'][.]{1,2}/", commit, "--", ...HOST_PATHS, SHARED_PATH).catch((error: unknown) => {
      if (error instanceof PublishCancelled) throw error;
      throw new UserError("officialPublish.error.changes");
    });
    return blockingChanges(changed, moduleFacingFiles(grep, files));
  }

  /** Whether CI finished green for that exact commit, still runs (or hasn't started), or failed. */
  private async ciState(commit: string, signal: AbortSignal | undefined): Promise<"green" | "pending" | "failed"> {
    let answer: string;
    try {
      answer = await this.run("gh", ["api", `repos/${GITHUB_REPO}/commits/${commit}/check-runs?per_page=100`], { cwd: this.options.repo, timeoutMs: 60_000, signal });
    } catch (error) {
      if (error instanceof PublishCancelled) throw error;
      throw new UserError("officialPublish.error.ci");
    }
    let runs: { status?: unknown; conclusion?: unknown }[];
    try {
      runs = (JSON.parse(answer) as { check_runs?: typeof runs }).check_runs ?? [];
    } catch {
      throw new UserError("officialPublish.error.ci");
    }
    const passed = (conclusion: unknown) => conclusion === "success" || conclusion === "skipped" || conclusion === "neutral";
    if (runs.some((item) => item.status === "completed" && !passed(item.conclusion))) return "failed";
    return runs.length > 0 && runs.every((item) => item.status === "completed") ? "green" : "pending";
  }

  private async readManifest(moduleDir: string, id: string) {
    const result = validateManifest(JSON.parse(await readFile(path.join(moduleDir, "tavora.module.json"), "utf8")));
    if (!result.ok || result.manifest.id !== id) throw new UserError("officialPublish.error.notBuiltIn");
    return result.manifest;
  }

  /** A clean install from the lockfile and a build of the module, in the temporary worktree. */
  private async build(worktree: string, moduleDir: string, step: (name: OfficialPublishStep) => void, signal: AbortSignal): Promise<void> {
    const pkg = JSON.parse(await readFile(path.join(moduleDir, "package.json"), "utf8")) as { name?: unknown };
    // The name goes to a command line; only the characters of a package name pass.
    if (typeof pkg.name !== "string" || !/^@?[a-z0-9][a-z0-9._/-]*$/.test(pkg.name)) throw new UserError("officialPublish.error.notBuiltIn");
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    try {
      step("install");
      await this.run(pnpm, ["install", "--frozen-lockfile"], { cwd: worktree, signal });
      step("build");
      await this.run(pnpm, ["--filter", `${pkg.name}...`, "build"], { cwd: worktree, signal });
    } catch (error) {
      if (error instanceof PublishCancelled || signal.aborted) throw new PublishCancelled();
      throw new UserError("officialPublish.error.build", { message: (error as Error).message });
    }
  }

  /** Writes minTavora into the built copy's manifest (the file in the worktree only, never in the repo) and answers with it. */
  private async setMinTavora(moduleDir: string, version: string): Promise<string> {
    const file = path.join(moduleDir, "tavora.module.json");
    const text = await readFile(file, "utf8");
    const manifest = JSON.parse(text) as Record<string, unknown>;
    const current = typeof manifest.minTavora === "string" ? manifest.minTavora : null;
    const minTavora = current && compareModuleVersions(current, version) > 0 ? current : version;
    manifest.minTavora = minTavora;
    await writeFile(file, `${JSON.stringify(manifest, null, /^([ \t]+)"/m.exec(text)?.[1] ?? "  ")}\n`);
    return minTavora;
  }

  /** The patch notes the changelog has for this version; none when it has no entry or no changelog. */
  private async notes(moduleDir: string, changelog: string | undefined, version: string): Promise<string[]> {
    if (!changelog) return [];
    try {
      const result = validateChangelog(JSON.parse(await readFile(path.join(moduleDir, changelog), "utf8")));
      return result.ok ? (result.entries.find((entry) => entry.version === version)?.notes ?? []) : [];
    } catch {
      return [];
    }
  }
}

function sha256Of(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Deletes a folder with retries: on Windows an antivirus scan or a closing build tool can hold a file for a moment. */
async function removeFolder(folder: string): Promise<void> {
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => undefined);
}
