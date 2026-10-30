import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createKeyFile, fingerprint, readZip, verifyFiles } from "@tavora/pack";
import { beforeEach, describe, expect, it } from "vitest";
import { OfficialPublisher, type Run } from "./official-publish";

const SHA = "a".repeat(40);
const manifest = (version: string, extra: object = {}) => ({ id: "tavora.notes", name: "Notes", version, apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: [] }, ...extra });

interface World {
  /** Files changed since the last release under the host paths. */
  changed: string;
  checks: { status: string; conclusion: string | null }[];
  version: string;
  shipped: string;
  listed: { version: string } | null;
  calls: string[];
  uploads: Buffer[];
  worktrees: string[];
}

let world: World;
let userData: string;
let keyFile: string;
let trustedKey: string;

beforeEach(async () => {
  world = { changed: "", checks: [{ status: "completed", conclusion: "success" }], version: "0.7.0", shipped: "0.6.1", listed: { version: "0.6.1" }, calls: [], uploads: [], worktrees: [] };
  userData = await mkdtemp(path.join(tmpdir(), "tavora-official-publish-"));
  keyFile = path.join(userData, "tavora.key");
  trustedKey = fingerprint((await createKeyFile(keyFile)).key);
});

const run: Run = async (command, args) => {
  world.calls.push([command.replace(/.cmd$/, ""), ...args].join(" "));
  const [first, second] = args;
  if (command === "git") {
    if (first === "fetch") return "";
    if (first === "rev-parse") return `${SHA}\n`;
    if (first === "tag") return "v0.23.0\nv0.22.0\nv0.9.0\n";
    if (first === "ls-tree") return "modules/notes\nmodules/shared\n";
    if (first === "show") {
      if (second === `${SHA}:modules/shared/tavora.module.json`) throw new Error("missing");
      return JSON.stringify(manifest(second?.startsWith("v0.23.0") ? world.shipped : world.version));
    }
    if (first === "diff") return world.changed;
    if (first === "worktree" && second === "add") {
      const dir = args[3]!;
      world.worktrees.push(dir);
      await mkdir(path.join(dir, "modules", "notes", "dist"), { recursive: true });
      await writeFile(path.join(dir, "modules", "notes", "tavora.module.json"), JSON.stringify(manifest(world.version)));
      await writeFile(path.join(dir, "modules", "notes", "package.json"), JSON.stringify({ name: "@tavora/module-notes" }));
      await writeFile(path.join(dir, "modules", "notes", "dist", "index.html"), "<p>notes</p>");
      return "";
    }
    return "";
  }
  if (command === "gh") return JSON.stringify({ check_runs: world.checks });
  return "";
};

const publisher = (overrides: Partial<ConstructorParameters<typeof OfficialPublisher>[0]> = {}) =>
  new OfficialPublisher({
    repo: "/repo",
    userData,
    run,
    listed: async () => world.listed,
    trusted: (key) => key === trustedKey,
    upload: async (_key, zip) => {
      world.uploads.push(zip);
      return { id: "tavora.notes", version: world.version, sha256: "b".repeat(64), status: "published", reasons: [] };
    },
    ...overrides,
  });

describe("publishing a built-in module from a dev build", () => {
  it("builds origin/main in a temporary worktree, sets minTavora, signs with the key file and uploads, recording the commit", async () => {
    const result = await publisher().publish("tavora.notes", keyFile);
    expect(result).toMatchObject({ id: "tavora.notes", version: "0.7.0", commit: SHA });
    expect(world.calls).toContain("git fetch origin main --tags --quiet");
    expect(world.calls.some((call) => call.startsWith("git worktree add --detach") && call.endsWith(SHA))).toBe(true);
    expect(world.calls).toContain("pnpm install --frozen-lockfile");
    expect(world.calls).toContain("pnpm --filter @tavora/module-notes... build");
    expect(world.calls.some((call) => call.startsWith("git worktree remove --force"))).toBe(true);
    const files = readZip(world.uploads[0]!);
    expect(verifyFiles(files)).toMatchObject({ ok: true, signed: true, owner: trustedKey });
    expect(JSON.parse(files.find((file) => file.name === "tavora.module.json")!.data.toString())).toMatchObject({ version: "0.7.0", minTavora: "0.23.0" });
    expect(await readFile(path.join(userData, "official-publishes.log"), "utf8")).toContain(SHA);
    // The key file is read for this upload only: nothing of it is written to the data folder.
    expect(await readdir(userData)).toEqual(expect.arrayContaining(["official-publishes.log"]));
    expect((await readdir(userData)).filter((name) => name !== "tavora.key" && name !== "official-publishes.log")).toEqual([]);
  });

  it("refuses, before building, when the app, SDK, schema or kit changed since the last release", async () => {
    world.changed = "packages/sdk/src/index.ts";
    await expect(publisher().publish("tavora.notes", keyFile)).rejects.toMatchObject({ key: "officialPublish.error.waitForRelease" });
    expect(world.calls.some((call) => call.startsWith("pnpm"))).toBe(false);
    const diff = world.calls.find((call) => call.startsWith("git diff"))!;
    for (const folder of ["apps/desktop/src", "packages/sdk", "packages/module-schema", "modules/shared"]) expect(diff).toContain(folder);
    expect(world.uploads).toEqual([]);
  });

  it("refuses without green CI for that commit: failed, still running, or none", async () => {
    for (const checks of [[{ status: "completed", conclusion: "failure" }], [{ status: "in_progress", conclusion: null }], []]) {
      world.checks = checks;
      await expect(publisher().publish("tavora.notes", keyFile)).rejects.toMatchObject({ key: "officialPublish.error.ciNotGreen" });
    }
    expect(world.uploads).toEqual([]);
  });

  it("refuses a version that is not newer than the catalogue or the module in the last release", async () => {
    world.version = "0.6.1";
    await expect(publisher().publish("tavora.notes", keyFile)).rejects.toMatchObject({ key: "officialPublish.error.notNewer" });
    world.version = "0.7.0";
    world.listed = { version: "0.7.0" };
    await expect(publisher().publish("tavora.notes", keyFile)).rejects.toMatchObject({ key: "officialPublish.error.notNewer" });
    world.listed = null;
    world.shipped = "0.7.0";
    await expect(publisher().publish("tavora.notes", keyFile)).rejects.toMatchObject({ key: "officialPublish.error.notNewer" });
    expect(world.uploads).toEqual([]);
  });

  it("refuses a key that is not Tavora's, and ids that are not built-in", async () => {
    await expect(publisher({ trusted: () => false }).publish("tavora.notes", keyFile)).rejects.toMatchObject({ key: "officialPublish.error.wrongKey" });
    await expect(publisher().publish("wellbrained.notes", keyFile)).rejects.toMatchObject({ key: "officialPublish.error.notBuiltIn" });
    await expect(publisher().publish("tavora.unknown", keyFile)).rejects.toMatchObject({ key: "officialPublish.error.notBuiltIn" });
    await expect(publisher().publish("tavora.notes", path.join(userData, "missing.key"))).rejects.toMatchObject({ key: "officialPublish.error.key" });
    expect(world.uploads).toEqual([]);
  });

  it("removes the worktree when the build fails, and allows one publish at a time", async () => {
    const failing: Run = async (command, args, options) => {
      if (command.startsWith("pnpm") && args[0] === "--filter") throw new Error("pnpm failed");
      return run(command, args, options);
    };
    await expect(publisher({ run: failing }).publish("tavora.notes", keyFile)).rejects.toMatchObject({ key: "officialPublish.error.build" });
    expect(world.calls.some((call) => call.startsWith("git worktree remove --force"))).toBe(true);
    const one = publisher();
    const first = one.publish("tavora.notes", keyFile);
    await expect(one.publish("tavora.notes", keyFile)).rejects.toMatchObject({ key: "officialPublish.error.busy" });
    await first;
  });
});
