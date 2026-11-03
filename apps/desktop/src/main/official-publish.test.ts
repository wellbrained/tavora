import { readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createKeyFile, fingerprint, readZip, verifyFiles } from "@tavora/pack";
import type { KeyObject } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blockingChanges, HOST_ONLY, isTestFile, moduleFacingFiles, OfficialPublisher, PublishCancelled, WORKTREE_PREFIX, type Run } from "./official-publish";

const SHA = "a".repeat(40);
const manifest = (version: string, extra: object = {}) => ({ id: "tavora.notes", name: "Notes", version, apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: [] }, changelog: "CHANGELOG.json", ...extra });

interface World {
  /** Files changed on main since the last release (git diff --name-only release commit). */
  changed: string;
  /** Files this checkout changed since the last release (git diff --name-only release). */
  local: string;
  /** git grep fails. */
  grepFails: boolean;
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
  world = { changed: "", local: "", grepFails: false, checks: [{ status: "completed", conclusion: "success" }], version: "0.7.0", shipped: "0.6.1", listed: { version: "0.6.1" }, calls: [], uploads: [], worktrees: [], buildGate: null };
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
  // git -c name=value … : the settings come first.
  let rest = args;
  while (command === "git" && rest[0] === "-c") rest = rest.slice(2);
  const [first, second] = rest;
  if (command === "git") {
    if (first === "fetch") return "";
    if (first === "rev-parse") return `${SHA}\n`;
    if (first === "tag") return "v0.23.0\nv0.22.0\nv0.9.0\n";
    if (first === "ls-tree" && second === "--name-only") return "modules/notes\nmodules/shared\nmodules/playground\n";
    if (first === "ls-tree") return "apps/desktop/src/main/index.ts\napps/desktop/src/main/bridge.ts\napps/desktop/src/main/games-seen.ts\napps/desktop/src/shared/wire.ts\napps/desktop/src/shared/patch-notes.ts\n";
    if (first === "grep") {
      if (world.grepFails) throw new Error("git grep failed");
      return `${SHA}:apps/desktop/src/main/bridge.ts:import { send } from "../shared/wire";\n${SHA}:apps/desktop/src/main/index.ts:import { seen } from "./games-seen";\n`;
    }
    if (first === "show") {
      if (second?.endsWith("modules/shared/tavora.module.json")) throw new Error("missing");
      if (second?.endsWith("modules/playground/tavora.module.json")) return JSON.stringify(manifest("9.9.9", { id: "tavora.playground" }));
      return JSON.stringify(manifest(second?.startsWith("v0.23.0") ? world.shipped : world.version));
    }
    if (first === "diff") {
      // `diff --name-only <release> -- …` is this checkout; with a commit it is main. Only the paths asked for.
      const paths = rest.slice(rest.indexOf("--") + 1);
      const local = rest[3] === "--";
      return (local ? world.local : world.changed)
        .split("\n")
        .filter((file) => file && paths.some((root) => file.startsWith(`${root}/`)))
        .join("\n");
    }
    if (first === "worktree" && second === "add") {
      const dir = rest[3]!;
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

  it("publishes when only the renderer, renderer-only shared files, the kit, tests, texts or host-window-only files changed", async () => {
    world.changed = [
      "apps/desktop/src/renderer/components/settings/DevelopmentSection.vue",
      "apps/desktop/src/shared/patch-notes.ts",
      "apps/desktop/src/shared/locales/en.ts",
      "apps/desktop/src/main/games-seen.ts",
      "apps/desktop/src/main/host.test.ts",
      "packages/sdk/src/index.test.ts",
    ].join("\n");
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

  it("refuses when this checkout's pack code or schema isn't the released one, since it signs with them", async () => {
    world.local = "packages/pack/src/signature.ts";
    await expect(publisher().prepare("tavora.notes")).rejects.toMatchObject({ key: "officialPublish.error.localPack" });
    world.local = "apps/desktop/src/renderer/App.vue\npackages/pack/src/pack.test.ts";
    await publisher().prepare("tavora.notes");
  });

  it("refuses when it can't tell which shared files the host loads, rather than letting a change through", async () => {
    world.changed = "apps/desktop/src/shared/wire.ts";
    world.grepFails = true;
    await expect(publisher().prepare("tavora.notes")).rejects.toMatchObject({ key: "officialPublish.error.changes" });
    expect(world.calls.find((call) => call.includes(" grep "))).toContain("--no-color");
  });

  it("a change to the pack format blocks like the SDK", async () => {
    world.changed = "packages/pack/src/zip.ts";
    await expect(publisher().prepare("tavora.notes")).rejects.toMatchObject({ key: "officialPublish.error.waitForRelease" });
  });

  it("refuses a same-size change after the preview, and can't be cancelled while uploading", async () => {
    const one = publisher();
    await one.prepare("tavora.notes");
    const page = path.join(world.worktrees[0]!, "modules", "notes", "dist", "index.html");
    await writeFile(page, "<p>NOTES</p>");
    await expect(one.finish(key)).rejects.toMatchObject({ key: "officialPublish.error.changed" });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = publisher({
      upload: async (_key, zip) => {
        await gate;
        world.uploads.push(zip);
        return { id: "tavora.notes", version: world.version, sha256: "b".repeat(64), status: "published", reasons: [] };
      },
    });
    await slow.prepare("tavora.notes");
    const steps: string[] = [];
    const finishing = slow.finish(key, (step) => steps.push(step));
    while (!steps.includes("upload")) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(slow.uploading).toBe(true);
    await slow.cancel();
    expect(slow.preview).not.toBeNull();
    release();
    await finishing;
    expect(world.uploads).toHaveLength(1);
  });

  it("takes only release tags that are on main", async () => {
    await publisher().check();
    expect(world.calls).toContain("git tag --list v* --merged origin/main --sort=-v:refname");
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

describe("the run, as the host window sees it", () => {
  /** A publisher that notes each change of its run as `phase` or `phase:step`. */
  function watched(overrides: Partial<ConstructorParameters<typeof OfficialPublisher>[0]> = {}) {
    const phases: string[] = [];
    const one: OfficialPublisher = publisher({
      onChange: () => {
        const run = one.view();
        phases.push("step" in run ? `${run.phase}:${run.step}` : run.phase);
      },
      ...overrides,
    });
    return { one, phases };
  }
  const gated = <T>() => {
    let open!: (value: T) => void;
    const gate = new Promise<T>((resolve) => (open = resolve));
    return { gate, open };
  };
  const until = async (check: () => boolean) => {
    while (!check()) await new Promise((resolve) => setTimeout(resolve, 5));
  };

  it("goes idle, building at each step, preview, confirming, uploading at each step, idle", async () => {
    const { one, phases } = watched();
    expect(one.view()).toEqual({ phase: "idle" });
    await one.prepare("tavora.notes", undefined, "Notes from the list");
    const preview = one.preview!;
    expect(one.view()).toEqual({ phase: "preview", moduleId: "tavora.notes", name: "Notes from the list", preview });
    const published = await one.confirm(async () => {
      expect(one.view()).toEqual({ phase: "confirming", moduleId: "tavora.notes", name: "Notes from the list", preview });
      return key;
    });
    expect(published).toMatchObject({ id: "tavora.notes", version: "0.7.0" });
    expect(phases).toEqual([
      "building:fetch",
      "building:check",
      "building:worktree",
      "building:install",
      "building:build",
      "building:pack",
      "preview",
      "confirming",
      "uploading:sign",
      "uploading:upload",
      "idle",
    ]);
    expect(one.view()).toEqual({ phase: "idle" });
  });

  it("shows the module's name from the start while building", async () => {
    const build = gated<void>();
    world.buildGate = build.gate;
    const { one, phases } = watched();
    const running = one.prepare("tavora.notes", undefined, "Notes from the list");
    await until(() => phases.includes("building:build"));
    expect(one.view()).toEqual({ phase: "building", moduleId: "tavora.notes", name: "Notes from the list", step: "build" });
    build.open();
    await running;
  });

  it("cancel: nothing when idle; stops a build; throws a preview away; waits while the key is loaded or the upload runs", async () => {
    // Idle.
    const idle = watched();
    await idle.one.cancel();
    expect(idle.one.view()).toEqual({ phase: "idle" });
    expect(idle.phases).toEqual([]);

    // Building: the step running now stops, and the run ends.
    const build = gated<void>();
    world.buildGate = build.gate;
    const building = watched();
    const running = building.one.prepare("tavora.notes");
    await until(() => building.phases.includes("building:build"));
    await building.one.cancel();
    await expect(running).rejects.toBeInstanceOf(PublishCancelled);
    build.open();
    expect(building.one.view()).toEqual({ phase: "idle" });
    world.buildGate = null;

    // Preview: thrown away, worktree and all.
    const preview = watched();
    await preview.one.prepare("tavora.notes");
    await preview.one.cancel();
    expect(preview.one.view()).toEqual({ phase: "idle" });
    expect(await readdir(temp)).toEqual([]);

    // Confirming: the key picker is open; cancel waits for it.
    const confirming = watched();
    await confirming.one.prepare("tavora.notes");
    const picked = gated<KeyObject | null>();
    const confirmed = confirming.one.confirm(() => picked.gate);
    expect(confirming.one.view().phase).toBe("confirming");
    await confirming.one.cancel();
    expect(confirming.one.view().phase).toBe("confirming");
    picked.open(key);
    await confirmed;
    expect(confirming.one.view()).toEqual({ phase: "idle" });
    expect(world.uploads).toHaveLength(1);

    // Uploading: nothing can stop it.
    const upload = gated<void>();
    const uploading = watched({
      upload: async (_key, zip) => {
        await upload.gate;
        world.uploads.push(zip);
        return { id: "tavora.notes", version: world.version, sha256: "b".repeat(64), status: "published", reasons: [] };
      },
    });
    await uploading.one.prepare("tavora.notes");
    const finishing = uploading.one.finish(key);
    await until(() => uploading.phases.includes("uploading:upload"));
    await uploading.one.cancel();
    expect(uploading.one.view().phase).toBe("uploading");
    upload.open();
    await finishing;
    expect(uploading.one.view()).toEqual({ phase: "idle" });
    expect(world.uploads).toHaveLength(2);
  });

  it("a failure while building ends the run", async () => {
    const failing: Run = async (command, args, options) => {
      if (command.startsWith("pnpm") && args[0] === "--filter") throw new Error("pnpm failed");
      return run(command, args, options);
    };
    const { one, phases } = watched({ run: failing });
    await expect(one.prepare("tavora.notes")).rejects.toMatchObject({ key: "officialPublish.error.build" });
    expect(phases.at(-2)).toBe("building:build");
    expect(phases.at(-1)).toBe("idle");
    expect(one.view()).toEqual({ phase: "idle" });
  });

  it("no key picked, or one that can't be loaded, goes back to the preview", async () => {
    const { one, phases } = watched();
    await one.prepare("tavora.notes");
    expect(await one.confirm(async () => null)).toBeNull();
    expect(one.view().phase).toBe("preview");
    await expect(
      one.confirm(async () => {
        throw new Error("not a key file");
      }),
    ).rejects.toThrow("not a key file");
    expect(one.view().phase).toBe("preview");
    expect(phases.slice(-4)).toEqual(["confirming", "preview", "confirming", "preview"]);
    expect(world.uploads).toEqual([]);
  });

  it("a wrong key or a failed upload keeps the preview; a build that changed or a catalogue that moved on ends the run", async () => {
    const other = (await createKeyFile(path.join(userData, "other.key"))).key;
    let offline = true;
    const { one, phases } = watched({
      upload: async (_key, zip) => {
        if (offline) throw new Error("offline");
        world.uploads.push(zip);
        return { id: "tavora.notes", version: world.version, sha256: "b".repeat(64), status: "published", reasons: [] };
      },
    });
    await one.prepare("tavora.notes");
    await expect(one.confirm(async () => other)).rejects.toMatchObject({ key: "officialPublish.error.wrongKey" });
    expect(phases.slice(-3)).toEqual(["confirming", "uploading:sign", "preview"]);
    await expect(one.finish(key)).rejects.toThrow("offline");
    expect(phases.slice(-3)).toEqual(["uploading:sign", "uploading:upload", "preview"]);
    offline = false;

    await writeFile(path.join(world.worktrees[0]!, "modules", "notes", "dist", "index.html"), "<p>changed</p>");
    await expect(one.finish(key)).rejects.toMatchObject({ key: "officialPublish.error.changed" });
    expect(one.view()).toEqual({ phase: "idle" });

    await one.prepare("tavora.notes");
    world.listed = { version: "0.7.0" };
    await expect(one.finish(key)).rejects.toMatchObject({ key: "officialPublish.error.notNewer" });
    expect(one.view()).toEqual({ phase: "idle" });
    expect(world.uploads).toEqual([]);
  });

  it("Sign and upload only from the preview: busy while it runs, nothing to sign without one", async () => {
    const { one } = watched();
    await expect(one.confirm(async () => key)).rejects.toMatchObject({ key: "officialPublish.error.notPrepared" });
    await one.prepare("tavora.notes");
    const picked = gated<KeyObject | null>();
    const confirmed = one.confirm(() => picked.gate);
    await expect(one.confirm(async () => key)).rejects.toMatchObject({ key: "officialPublish.error.busy" });
    await expect(one.finish(key)).rejects.toMatchObject({ key: "officialPublish.error.notPrepared" });
    await expect(one.prepare("tavora.notes")).rejects.toMatchObject({ key: "officialPublish.error.busy" });
    picked.open(null);
    await confirmed;
    expect(one.view().phase).toBe("preview");
    await one.cancel();
  });

  it("a prepare started while a thrown-away build is still being removed waits for the removal", async () => {
    const removal = gated<void>();
    const removing: string[] = [];
    const slowRemoval: Run = async (command, args, options) => {
      if (command === "git" && args[0] === "worktree" && args[1] === "remove") {
        removing.push("start");
        await removal.gate;
        removing.push("end");
      }
      return run(command, args, options);
    };
    const { one } = watched({ run: slowRemoval });
    await one.prepare("tavora.notes");
    const cancelling = one.cancel();
    await until(() => removing.includes("start"));
    // The window already reads idle, but the old worktree is not gone yet.
    expect(one.view()).toEqual({ phase: "idle" });
    const second = one.prepare("tavora.notes");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(world.worktrees).toHaveLength(1);
    expect(removing).toEqual(["start"]);
    removal.open();
    await cancelling;
    await second;
    expect(removing).toEqual(["start", "end"]);
    expect(world.worktrees).toHaveLength(2);
    expect(one.view().phase).toBe("preview");
    await one.cancel();
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
  const A = "apps/desktop/src";
  const files = [`${A}/main/bridge.ts`, `${A}/main/games-seen.ts`, `${A}/main/steam-played.ts`, `${A}/main/installed-list.ts`, `${A}/main/host.ts`, `${A}/main/grants.ts`, `${A}/main/steam-import.ts`, `${A}/preload/module.ts`, `${A}/shared/wire.ts`, `${A}/shared/i18n.ts`, `${A}/shared/locales/en.ts`, `${A}/shared/host-api.ts`, `${A}/shared/patch-notes.ts`, `${A}/shared/only-tests.ts`];
  const grep = [
    `${SHA}:${A}/main/bridge.ts:import { grant } from "./grants";`,
    `${SHA}:${A}/main/bridge.ts:import type { Api } from "../shared/host-api";`,
    `${SHA}:${A}/main/bridge.ts:import { type Api, type Other } from "../shared/host-api";`,
    `${SHA}:${A}/main/bridge.ts:export type { Api } from "../shared/host-api";`,
    `${SHA}:${A}/main/grants.ts:import { steamImport } from "./steam-import";`,
    `${SHA}:${A}/main/host.ts:import { Bridge } from "./bridge";`,
    `${SHA}:${A}/main/host.ts:import { GamesSeen } from "./games-seen";`,
    `${SHA}:${A}/main/grants.ts:} from "../shared/i18n";`,
    `${SHA}:${A}/main/host.ts:import { seen } from "./installed-list";`,
    `${SHA}:${A}/main/installed-list.ts:import { played } from "./steam-played";`,
    `${SHA}:${A}/main/host.test.ts:import { x } from "../shared/only-tests";`,
    `${SHA}:${A}/preload/module.ts:import { wire } from '../shared/wire.ts';`,
    `${SHA}:${A}/shared/i18n.ts:const en = await import("./locales/en");`,
  ].join("\n");

  it("starts from the main and preload files that are not host-window-only and follows their run-time imports, never types or tests", () => {
    const reached = moduleFacingFiles(grep, files);
    expect([...reached].sort()).toEqual([`${A}/main/bridge.ts`, `${A}/main/grants.ts`, `${A}/main/steam-import.ts`, `${A}/preload/module.ts`, `${A}/shared/i18n.ts`, `${A}/shared/locales/en.ts`, `${A}/shared/wire.ts`].sort());
    // Host-window-only files nothing module-facing loads, a type-only import and a file only a test loads stay out.
    for (const file of ["main/host.ts", "main/games-seen.ts", "main/installed-list.ts", "main/steam-played.ts", "shared/host-api.ts", "shared/only-tests.ts"]) expect(reached.has(`${A}/${file}`)).toBe(false);
  });

  it("blocks on SDK, schema and pack sources, on any main or preload file nobody sorted, and on host-window-only or shared files module-facing code loads", () => {
    const reached = moduleFacingFiles(grep, files);
    const changed = [
      `${A}/main/bridge.ts`, // module-facing
      `${A}/main/never-heard-of.ts`, // new, unsorted: blocks
      `${A}/main/steam-import.ts`, // host-window-only, but grants.ts loads it
      `${A}/preload/relay.ts`,
      `${A}/shared/wire.ts`, // loaded by the module preload
      `${A}/shared/i18n.ts`, // loaded by module-facing code
      "packages/sdk/src/protocol.ts",
      "packages/module-schema/src/index.ts",
      "packages/pack/src/zip.ts",
    ];
    expect(blockingChanges(changed, reached)).toEqual(changed);
  });

  it("does not block on tests, the renderer, text tables, type files, host-window-only files or shared files only the host window loads", () => {
    const reached = moduleFacingFiles(grep, files);
    const changed = [
      `${A}/main/host.ts`,
      `${A}/main/games-seen.ts`,
      `${A}/main/installed-list.ts`,
      `${A}/main/steam-played.ts`,
      `${A}/main/index.ts`,
      `${A}/preload/host.ts`,
      `${A}/shared/locales/en.ts`,
      `${A}/shared/locales/de.ts`,
      `${A}/shared/host-api.ts`,
      `${A}/shared/patch-notes.ts`,
      `${A}/renderer/App.vue`,
      `${A}/main/official-publish.test.ts`,
      `${A}/main/panel-views.test-helper.ts`,
      "packages/sdk/src/store.test.ts",
    ];
    expect(blockingChanges(changed, reached)).toEqual([]);
    expect(isTestFile(`${A}/main/steam-appinfo.fixture.ts`)).toBe(true);
  });

  // The real files, in git grep's form, so the rule is checked against the code as it is.
  const root = path.resolve(__dirname, "../../../..");
  const real = () => {
    const list: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(path.join(root, dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
        else list.push(rel);
      }
    };
    for (const dir of [`${A}/main`, `${A}/preload`, `${A}/shared`]) walk(dir);
    const lines = list.filter((file) => /\.[cm]?[jt]s$/.test(file)).flatMap((file) => readFileSync(path.join(root, file), "utf8").split(/\r?\n/).map((text) => `${SHA}:${file}:${text}`));
    return { list, reached: moduleFacingFiles(lines.join("\n"), list) };
  };

  it("on this repo: the bridge, the module view, the module preload and what they load block", () => {
    const { reached } = real();
    for (const file of ["main/bridge.ts", "main/module-view.ts", "main/streaming.ts", "main/game-overlay-service.ts", "main/overlays.ts", "main/hotkeys.ts", "main/leaderboards.ts", "main/assets.ts", "main/registry.ts", "main/errors.ts", "preload/module.ts", "preload/relay.ts", "shared/wire.ts", "shared/i18n.ts"]) {
      expect(blockingChanges([`${A}/${file}`], reached), file).toEqual([`${A}/${file}`]);
    }
    // Patch notes are the renderer's only; the host API file is types the main process only imports as types.
    expect(reached.has(`${A}/shared/patch-notes.ts`)).toBe(false);
    expect(reached.has(`${A}/shared/host-api.ts`)).toBe(false);
  });

  it("on this repo: no host-window-only file is one module-facing code loads (else it must come off the list)", () => {
    const { list, reached } = real();
    const loaded = [...HOST_ONLY].filter((file) => reached.has(file));
    expect(loaded).toEqual([]);
    // And the list names real files.
    expect([...HOST_ONLY].filter((file) => !list.includes(file))).toEqual([]);
  });

  it("on this repo: the welcome and game-detection work since v0.23.31 does not block a module", () => {
    const { reached } = real();
    const changed = ["catalog-client", "game-watch", "games-seen", "host", "index", "installed-list", "launcher-games", "steam-played"].map((name) => `${A}/main/${name}.ts`);
    changed.push(`${A}/preload/host.ts`, `${A}/shared/host-api.ts`, `${A}/shared/locales/en.ts`, `${A}/shared/locales/de.ts`, `${A}/shared/patch-notes.ts`);
    expect(blockingChanges(changed, reached)).toEqual([]);
  });

  it("on this repo: the publish tooling's own files do not block, so this change needs no app release", () => {
    const { reached } = real();
    const changed = [`${A}/main/official-publish.ts`, `${A}/main/official-publish.test.ts`, `${A}/renderer/components/settings/DevelopmentSection.vue`, `${A}/renderer/components/developer/OfficialPublishDialog.vue`, `${A}/shared/locales/en.ts`, `${A}/shared/locales/de.ts`];
    expect(blockingChanges(changed, reached)).toEqual([]);
    // Nothing module-facing loads the tooling.
    for (const file of ["main/official-publish.ts", "main/official-key-store.ts", "main/module-publish.ts"]) expect(reached.has(`${A}/${file}`)).toBe(false);
  });
});
