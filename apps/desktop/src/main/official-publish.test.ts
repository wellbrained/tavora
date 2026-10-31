import { readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createKeyFile, fingerprint, readZip, verifyFiles } from "@tavora/pack";
import type { KeyObject } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blockingChanges, hostSharedFiles, isTestFile, OfficialPublisher, PublishCancelled, WORKTREE_PREFIX, type Run } from "./official-publish";

const SHA = "a".repeat(40);
const manifest = (version: string, extra: object = {}) => ({ id: "tavora.notes", name: "Notes", version, apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: [] }, changelog: "CHANGELOG.json", ...extra });

interface World {
  /** Files changed since the last release (git diff --name-only). */
  changed: string;
  checks: { status: string; conclusion: string | null }[];
  version: string;
  shipped: string;
  listed: { version: string } | null;
  calls: string[];
  uploads: Buffer[];
  worktrees: string[];
  /** Holds the build until released, to cancel in the middle. */
  buildGate: Promise<void> | null;
}

let world: World;
let userData: string;
let temp: string;
let keyFile: string;
let key: KeyObject;
let trustedKey: string;

beforeEach(async () => {
  world = { changed: "", checks: [{ status: "completed", conclusion: "success" }], version: "0.7.0", shipped: "0.6.1", listed: { version: "0.6.1" }, calls: [], uploads: [], worktrees: [], buildGate: null };
  userData = await mkdtemp(path.join(tmpdir(), "tavora-publish-test-"));
  temp = path.join(userData, "temp");
  await mkdir(temp);
  keyFile = path.join(userData, "tavora.key");
  key = (await createKeyFile(keyFile)).key;
  trustedKey = fingerprint(key);
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

const run: Run = async (command, args, options) => {
  world.calls.push([command.replace(/.cmd$/, ""), ...args].join(" "));
  const [first, second] = args;
  if (command === "git") {
    if (first === "fetch") return "";
    if (first === "rev-parse") return `${SHA}\n`;
    if (first === "tag") return "v0.23.0\nv0.22.0\nv0.9.0\n";
    if (first === "ls-tree" && second === "--name-only") return "modules/notes\nmodules/shared\nmodules/playground\n";
    if (first === "ls-tree") return "apps/desktop/src/main/index.ts\napps/desktop/src/shared/wire.ts\napps/desktop/src/shared/patch-notes.ts\n";
    if (first === "grep") return `${SHA}:apps/desktop/src/main/index.ts:import { send } from "../shared/wire";\n`;
    if (first === "show") {
      if (second?.endsWith("modules/shared/tavora.module.json")) throw new Error("missing");
      if (second?.endsWith("modules/playground/tavora.module.json")) return JSON.stringify(manifest("9.9.9", { id: "tavora.playground" }));
      return JSON.stringify(manifest(second?.startsWith("v0.23.0") ? world.shipped : world.version));
    }
    if (first === "diff") return world.changed;
    if (first === "worktree" && second === "add") {
      const dir = args[3]!;
      world.worktrees.push(dir);
      const module = path.join(dir, "modules", "notes");
      await mkdir(path.join(module, "dist"), { recursive: true });
      await mkdir(path.join(dir, "node_modules", ".pnpm"), { recursive: true });
      await writeFile(path.join(module, "tavora.module.json"), JSON.stringify(manifest(world.version)));
      await writeFile(path.join(module, "CHANGELOG.json"), JSON.stringify([{ version: world.version, notes: ["Faster search."] }, { version: "0.6.1", notes: ["Older."] }]));
      await writeFile(path.join(module, "package.json"), JSON.stringify({ name: "@tavora/module-notes" }));
      await writeFile(path.join(module, "dist", "index.html"), "<p>notes</p>");
      return "";
    }
    return "";
  }
  if (command === "gh") return JSON.stringify({ check_runs: world.checks });
  if (command.startsWith("pnpm") && first === "--filter" && world.buildGate) {
    await Promise.race([world.buildGate, new Promise((_, reject) => options.signal?.addEventListener("abort", () => reject(new PublishCancelled())))]);
  }
  return "";
};

const publisher = (overrides: Partial<ConstructorParameters<typeof OfficialPublisher>[0]> = {}) =>
  new OfficialPublisher({
    repo: "/repo",
    userData,
    temp,
    run,
    listed: async () => world.listed,
    trusted: (signer) => signer === trustedKey,
    upload: async (_key, zip) => {
      world.uploads.push(zip);
      return { id: "tavora.notes", version: world.version, sha256: "b".repeat(64), status: "published", reasons: [] };
    },
    ...overrides,
  });

describe("publishing a built-in module from a dev build", () => {
  it("builds origin/main in a temporary worktree, shows a preview, then signs exactly that and uploads, recording the commit", async () => {
    const one = publisher();
    const steps: string[] = [];
    const preview = await one.prepare("tavora.notes", (step) => steps.push(step));
    expect(steps).toEqual(["fetch", "check", "worktree", "install", "build", "pack"]);
    expect(preview).toMatchObject({ id: "tavora.notes", name: "Notes", version: "0.7.0", shipped: "0.6.1", listed: "0.6.1", commit: SHA, release: "v0.23.0", minTavora: "0.23.0", notes: ["Faster search."] });
    expect(preview.files.map((file) => file.name)).toEqual(["CHANGELOG.json", "dist/index.html", "tavora.module.json"]);
    expect(world.calls).toContain("git fetch origin main --tags --quiet");
    expect(world.calls.some((call) => call.startsWith("git worktree add --detach") && call.endsWith(SHA))).toBe(true);
    expect(world.calls).toContain("pnpm install --frozen-lockfile");
    expect(world.calls).toContain("pnpm --filter @tavora/module-notes... build");
    // Nothing went up before the preview, and the worktree waits for Sign and upload.
    expect(world.uploads).toEqual([]);
    expect(world.calls.some((call) => call.startsWith("git worktree remove"))).toBe(false);

    const uploadSteps: string[] = [];
    const result = await one.finish(key, (step) => uploadSteps.push(step));
    expect(uploadSteps).toEqual(["sign", "upload"]);
    expect(result).toMatchObject({ id: "tavora.notes", version: "0.7.0", commit: SHA });
    const files = readZip(world.uploads[0]!);
    expect(verifyFiles(files)).toMatchObject({ ok: true, signed: true, owner: trustedKey });
    expect(JSON.parse(files.find((file) => file.name === "tavora.module.json")!.data.toString())).toMatchObject({ version: "0.7.0", minTavora: "0.23.0" });
    expect(await readFile(path.join(userData, "official-publishes.log"), "utf8")).toContain(SHA);
    // The worktree is gone, node_modules and all, and git forgot it.
    expect(world.calls.some((call) => call.startsWith("git worktree remove --force"))).toBe(true);
    expect(world.calls).toContain("git worktree prune");
    expect(await readdir(temp)).toEqual([]);
    expect(one.preview).toBeNull();
  });

  it("refuses a key that may not sign Tavora's modules and keeps the preview for another try", async () => {
    const one = publisher();
    await one.prepare("tavora.notes");
    const other = (await createKeyFile(path.join(userData, "other.key"))).key;
    await expect(one.finish(other)).rejects.toMatchObject({ key: "officialPublish.error.wrongKey" });
    expect(world.uploads).toEqual([]);
    expect(one.preview).not.toBeNull();
    await one.finish(key);
    expect(world.uploads).toHaveLength(1);
  });

  it("refuses at Sign and upload when the build changed after the preview, or the catalogue moved on", async () => {
    const one = publisher();
    await one.prepare("tavora.notes");
    await writeFile(path.join(world.worktrees[0]!, "modules", "notes", "dist", "index.html"), "<p>something else entirely</p>");
    await expect(one.finish(key)).rejects.toMatchObject({ key: "officialPublish.error.changed" });
    expect(one.preview).toBeNull();

    await one.prepare("tavora.notes");
    world.listed = { version: "0.7.0" };
    await expect(one.finish(key)).rejects.toMatchObject({ key: "officialPublish.error.notNewer" });
    expect(world.uploads).toEqual([]);
  });

  it("refuses, before building, when host code, the SDK or the schema changed since the last release", async () => {
    for (const changed of ["packages/sdk/src/index.ts", "packages/module-schema/src/index.ts", "apps/desktop/src/main/grants.ts", "apps/desktop/src/preload/module.ts", "apps/desktop/src/shared/wire.ts"]) {
      world.changed = changed;
      await expect(publisher().prepare("tavora.notes")).rejects.toMatchObject({ key: "officialPublish.error.waitForRelease" });
    }
    expect(world.calls.some((call) => call.startsWith("pnpm"))).toBe(false);
    expect(world.uploads).toEqual([]);
  });

  it("publishes when only the renderer, renderer-only shared files, the kit or tests changed", async () => {
    world.changed = ["apps/desktop/src/renderer/components/settings/DevelopmentSection.vue", "apps/desktop/src/shared/patch-notes.ts", "apps/desktop/src/main/host.test.ts", "packages/sdk/src/index.test.ts"].join("\n");
    const one = publisher();
    await one.prepare("tavora.notes");
    await one.finish(key);
    expect(world.uploads).toHaveLength(1);
    const diff = world.calls.find((call) => call.startsWith("git diff"))!;
    expect(diff).not.toContain("modules/shared");
  });

  it("refuses without green CI for that commit: failed, still running, or none", async () => {
    for (const checks of [[{ status: "completed", conclusion: "failure" }], [{ status: "in_progress", conclusion: null }], []]) {
      world.checks = checks;
      await expect(publisher().prepare("tavora.notes")).rejects.toMatchObject({ key: "officialPublish.error.ciNotGreen" });
    }
    expect(world.uploads).toEqual([]);
  });

  it("refuses a version that is not newer than the catalogue or the module in the last release", async () => {
    world.version = "0.6.1";
    await expect(publisher().prepare("tavora.notes")).rejects.toMatchObject({ key: "officialPublish.error.notNewer" });
    world.version = "0.7.0";
    world.listed = { version: "0.7.0" };
    await expect(publisher().prepare("tavora.notes")).rejects.toMatchObject({ key: "officialPublish.error.notNewer" });
    world.listed = null;
    world.shipped = "0.7.0";
    await expect(publisher().prepare("tavora.notes")).rejects.toMatchObject({ key: "officialPublish.error.notNewer" });
    expect(world.uploads).toEqual([]);
  });

  it("refuses ids that are not built-in, the Browser and the Playground", async () => {
    for (const id of ["wellbrained.notes", "tavora.unknown", "tavora.browser", "tavora.playground"]) await expect(publisher().prepare(id)).rejects.toMatchObject({ key: "officialPublish.error.notBuiltIn" });
    await expect(publisher().finish(key)).rejects.toMatchObject({ key: "officialPublish.error.notPrepared" });
  });

  it("removes the worktree when the build fails, and allows one publish at a time", async () => {
    const failing: Run = async (command, args, options) => {
      if (command.startsWith("pnpm") && args[0] === "--filter") throw new Error("pnpm failed");
      return run(command, args, options);
    };
    await expect(publisher({ run: failing }).prepare("tavora.notes")).rejects.toMatchObject({ key: "officialPublish.error.build" });
    expect(world.calls.some((call) => call.startsWith("git worktree remove --force"))).toBe(true);
    expect(await readdir(temp)).toEqual([]);
    const one = publisher();
    const first = one.prepare("tavora.notes");
    await expect(one.prepare("tavora.notes")).rejects.toMatchObject({ key: "officialPublish.error.busy" });
    await first;
    // A preview is open: another prepare waits for it.
    await expect(one.prepare("tavora.notes")).rejects.toMatchObject({ key: "officialPublish.error.busy" });
    await one.cancel();
    expect(one.preview).toBeNull();
    expect(await readdir(temp)).toEqual([]);
  });

  it("cancel stops a build in progress and removes its worktree", async () => {
    let release!: () => void;
    world.buildGate = new Promise((resolve) => (release = resolve));
    const one = publisher();
    const steps: string[] = [];
    const running = one.prepare("tavora.notes", (step) => steps.push(step));
    while (!steps.includes("build")) await new Promise((resolve) => setTimeout(resolve, 5));
    await one.cancel();
    await expect(running).rejects.toBeInstanceOf(PublishCancelled);
    release();
    expect(one.preview).toBeNull();
    expect(await readdir(temp)).toEqual([]);
  });

  it("sweeps worktrees an earlier run left behind once they are old, never a fresh one", async () => {
    const old = path.join(temp, `${WORKTREE_PREFIX}old`);
    const fresh = path.join(temp, `${WORKTREE_PREFIX}fresh`);
    const other = path.join(temp, "something-else");
    for (const dir of [old, fresh, other]) await mkdir(path.join(dir, "node_modules"), { recursive: true });
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(old, twoHoursAgo, twoHoursAgo);
    await publisher().sweep();
    expect((await readdir(temp)).sort()).toEqual(["something-else", `${WORKTREE_PREFIX}fresh`]);
  });
});

describe("the list of built-in modules to publish", () => {
  it("lists only modules newer on main than in the last release, never the Playground, each with its status", async () => {
    expect(await publisher().check()).toEqual({ commit: SHA, release: "v0.23.0", rows: [{ id: "tavora.notes", name: "Notes", version: "0.7.0", shipped: "0.6.1", listed: "0.6.1", status: "ready" }], hostChanges: [] });
    world.listed = { version: "0.7.0" };
    expect((await publisher().check()).rows[0]!.status).toBe("published");
    world.listed = { version: "0.8.0" };
    expect((await publisher().check()).rows[0]!.status).toBe("catalogueNewer");
    world.listed = null;
    world.checks = [{ status: "queued", conclusion: null }];
    expect((await publisher().check()).rows[0]!.status).toBe("ciPending");
    world.checks = [{ status: "completed", conclusion: "failure" }];
    expect((await publisher().check()).rows[0]!.status).toBe("ciFailed");
    world.changed = "apps/desktop/src/main/grants.ts";
    expect(await publisher().check()).toMatchObject({ rows: [{ status: "waitForRelease" }], hostChanges: ["apps/desktop/src/main/grants.ts"] });
    world.version = "0.6.1";
    expect((await publisher().check()).rows).toEqual([]);
    expect(world.uploads).toEqual([]);
    expect(world.calls.some((call) => call.startsWith("pnpm") || call.startsWith("git worktree add"))).toBe(false);
  });
});

describe("which changes make a module update wait for the next app release", () => {
  const files = ["apps/desktop/src/main/index.ts", "apps/desktop/src/main/host.ts", "apps/desktop/src/preload/module.ts", "apps/desktop/src/shared/wire.ts", "apps/desktop/src/shared/i18n.ts", "apps/desktop/src/shared/locales/en.ts", "apps/desktop/src/shared/patch-notes.ts", "apps/desktop/src/shared/only-tests.ts"];
  const grep = [
    `${SHA}:apps/desktop/src/main/index.ts:import { Host } from "./host";`,
    `${SHA}:apps/desktop/src/main/host.ts:} from "../shared/i18n";`,
    `${SHA}:apps/desktop/src/main/host.test.ts:import { x } from "../shared/only-tests";`,
    `${SHA}:apps/desktop/src/preload/module.ts:import { wire } from '../shared/wire.ts';`,
    `${SHA}:apps/desktop/src/shared/i18n.ts:const en = await import("./locales/en");`,
  ].join("\n");

  it("follows the main process and preloads into shared code, through other shared files, never from tests", () => {
    expect([...hostSharedFiles(grep, files)].sort()).toEqual(["apps/desktop/src/shared/i18n.ts", "apps/desktop/src/shared/locales/en.ts", "apps/desktop/src/shared/wire.ts"]);
  });

  it("blocks on host, preload, SDK and schema sources and host-loaded shared files; never on the renderer, renderer-only shared files, the kit or tests", () => {
    const shared = hostSharedFiles(grep, files);
    const changed = [
      "apps/desktop/src/main/steam-import.ts",
      "apps/desktop/src/preload/relay.ts",
      "packages/sdk/src/protocol.ts",
      "packages/module-schema/src/index.ts",
      "apps/desktop/src/shared/locales/en.ts",
      "apps/desktop/src/shared/patch-notes.ts",
      "apps/desktop/src/renderer/App.vue",
      "apps/desktop/src/main/official-publish.test.ts",
      "packages/sdk/src/store.test.ts",
      "apps/desktop/src/main/panel-views.test-helper.ts",
    ];
    expect(blockingChanges(changed, shared)).toEqual(["apps/desktop/src/main/steam-import.ts", "apps/desktop/src/preload/relay.ts", "packages/sdk/src/protocol.ts", "packages/module-schema/src/index.ts", "apps/desktop/src/shared/locales/en.ts"]);
    expect(isTestFile("apps/desktop/src/main/steam-appinfo.fixture.ts")).toBe(true);
  });

  it("on this repo: the host loads wire and the locales; patch notes are the renderer's only", () => {
    // The real files, in git grep's form, so the rule is checked against the code as it is.
    const root = path.resolve(__dirname, "../../../..");
    const list: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(path.join(root, dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
        else list.push(rel);
      }
    };
    for (const dir of ["apps/desktop/src/main", "apps/desktop/src/preload", "apps/desktop/src/shared"]) walk(dir);
    const lines = list.filter((file) => /\.[cm]?[jt]s$/.test(file)).flatMap((file) => readFileSync(path.join(root, file), "utf8").split(/\r?\n/).map((text) => `${SHA}:${file}:${text}`));
    const shared = hostSharedFiles(lines.join("\n"), list);
    expect(shared.has("apps/desktop/src/shared/wire.ts")).toBe(true);
    expect(shared.has("apps/desktop/src/shared/locales/en.ts")).toBe(true);
    expect(shared.has("apps/desktop/src/shared/patch-notes.ts")).toBe(false);
  });
});
