import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fingerprint, readZip, verifyFiles } from "@tavora/pack";
import { afterEach, describe, expect, it } from "vitest";
import type { PrefixState, PublishView } from "../shared/host-api";
import { translate } from "../shared/i18n";
import { UserError } from "./messages";
import { ModulePublisher, nextVersions, writeVersion } from "./module-publish";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const MANIFEST = { id: "me.tracker", name: "Tracker", version: "1.2.3", apiVersion: "1", entry: "dist/index.html", changelog: "changelog.json", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: ["api.example.com"] } };

/** A built module project, like the starter makes. */
async function project(manifest: Record<string, unknown> = MANIFEST, { built = true } = {}): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tavora-publish-"));
  dirs.push(dir);
  await mkdir(path.join(dir, "src"));
  await writeFile(path.join(dir, "src", "main.ts"), "export {};");
  if (built) {
    await mkdir(path.join(dir, "dist"));
    await writeFile(path.join(dir, "dist", "index.html"), "<p>hi</p>");
  }
  await writeFile(path.join(dir, "tavora.module.json"), `${JSON.stringify(manifest, null, 4)}\n`);
  await writeFile(path.join(dir, "changelog.json"), JSON.stringify([{ version: "1.2.3", notes: ["Timers count down."] }]));
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "tracker", version: "1.2.3" }, null, 2));
  return dir;
}

function publisher(options: { listed?: { version: string; owner: string } | null | "offline"; prefix?: PrefixState; refuse?: UserError; noKey?: boolean; waits?: boolean } = {}) {
  const { privateKey } = generateKeyPairSync("ed25519");
  const uploads: Buffer[] = [];
  const views: (PublishView | null)[] = [];
  let prefix = options.prefix ?? "held";
  const publisher = new ModulePublisher({
    key: () => (options.noKey ? null : { key: privateKey, fingerprint: fingerprint(privateKey) }),
    account: {
      prefixes: () => ({ held: [{ prefix: "me", claimedAt: 1, published: true }], max: 3 }),
      developerName: () => "Me",
      checkPrefix: async () => prefix,
      upload: async (_key, zip) => {
        if (options.refuse) throw options.refuse;
        uploads.push(zip);
        return { id: "me.tracker", version: "1.2.3", sha256: createHash("sha256").update(zip).digest("hex"), status: options.waits ? "waiting" : "published", reasons: [] };
      },
    },
    listed: async () => {
      if (options.listed === "offline") throw new Error("offline");
      return options.listed ?? null;
    },
    check: async () => undefined,
    icon: () => null,
    translate: (error) => translate("en", error.key, error.params),
    onChange: (view) => views.push(view),
    now: () => Date.UTC(2026, 9, 21, 12),
  });
  return { publisher, uploads, views, owner: fingerprint(privateKey), setPrefix: (next: PrefixState) => (prefix = next) };
}

describe("ModulePublisher", () => {
  it("packs the project as it is and publishes exactly that zip, signed with the kept key", async () => {
    const dir = await project();
    const { publisher: reviewer, uploads, views, owner } = publisher({ prefix: "free" });
    await reviewer.open(dir);
    const view = reviewer.view()!;
    expect(views[0]).toMatchObject({ status: "checking", module: { id: "me.tracker", name: "Tracker", version: "1.2.3" } });
    expect(view).toMatchObject({
      status: "ready",
      module: { id: "me.tracker", name: "Tracker", version: "1.2.3" },
      notes: ["Timers count down."],
      asks: { network: ["api.example.com"], connectors: [] },
      catalog: { kind: "first" },
      problems: [],
      newPrefix: { prefix: "me", max: 3 },
      sourceNewer: false,
    });
    expect(view.size).toBeGreaterThan(0);
    expect(view.builtAt).toBeGreaterThan(0);

    await reviewer.publish();
    expect(reviewer.view()).toMatchObject({ status: "published", published: { id: "me.tracker", version: "1.2.3" } });
    expect(reviewer.view()?.published?.waiting).toBeUndefined();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.length).toBe(view.size);
    expect(verifyFiles(readZip(uploads[0]!))).toEqual({ ok: true, owner, signed: true });

    reviewer.close();
    expect(reviewer.view()).toBeNull();
  });

  it("says so when a person at Tavora looks at the upload before it lists", async () => {
    const dir = await project();
    const { publisher: reviewer } = publisher({ waits: true });
    await reviewer.open(dir);
    await reviewer.publish();
    expect(reviewer.view()).toMatchObject({ status: "published", published: { id: "me.tracker", version: "1.2.3", waiting: true } });
  });

  it("offers the next versions when the catalog has this one, and writes the pick into the project", async () => {
    const dir = await project();
    const { publisher: reviewer } = publisher({ listed: { version: "1.2.3", owner: "x" } });
    await reviewer.open(dir);
    expect(reviewer.view()).toMatchObject({ catalog: { kind: "update", version: "1.2.3" }, problems: [{ kind: "version", listed: "1.2.3", next: { patch: "1.2.4", minor: "1.3.0", major: "2.0.0" } }] });
    await expect(reviewer.publish()).rejects.toMatchObject({ key: "publish.error.notReady" });

    await reviewer.writeVersion("1.2.4", [" Faster timers. ", "", "A new sound."]);
    expect(reviewer.view()).toMatchObject({ problems: [], module: { version: "1.2.4" }, notes: ["Faster timers.", "A new sound."] });
    const manifest = await readFile(path.join(dir, "tavora.module.json"), "utf8");
    expect(manifest).toContain('    "version": "1.2.4"');
    expect(JSON.parse(await readFile(path.join(dir, "changelog.json"), "utf8"))).toEqual([
      { version: "1.2.4", date: "2026-10-21", notes: ["Faster timers.", "A new sound."] },
      { version: "1.2.3", notes: ["Timers count down."] },
    ]);
    expect(JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")).version).toBe("1.2.4");
  });

  it("lets a module whose prefix isn't the developer's take a new id before its first publish", async () => {
    const dir = await project({ ...MANIFEST, id: "local.tracker" });
    const { publisher: reviewer, setPrefix } = publisher({ prefix: "reserved" });
    await reviewer.open(dir);
    expect(reviewer.view()).toMatchObject({ problems: [{ kind: "prefix", prefix: "local", state: "reserved" }], ownPrefix: "me" });
    setPrefix("held");
    await reviewer.setId("me.tracker");
    expect(reviewer.view()).toMatchObject({ module: { id: "me.tracker" }, problems: [] });
    expect(JSON.parse(await readFile(path.join(dir, "tavora.module.json"), "utf8")).id).toBe("me.tracker");
  });

  it("says when nothing is built, and when the sources changed after the build", async () => {
    const dir = await project(MANIFEST, { built: false });
    const { publisher: reviewer } = publisher({ listed: "offline" });
    await reviewer.open(dir);
    expect(reviewer.view()).toMatchObject({ catalog: { kind: "unknown" }, problems: [{ kind: "not-built" }], size: null });

    await mkdir(path.join(dir, "dist"));
    await writeFile(path.join(dir, "dist", "index.html"), "<p>hi</p>");
    const old = new Date(Date.now() - 60_000);
    await utimes(path.join(dir, "dist", "index.html"), old, old);
    await reviewer.refresh();
    expect(reviewer.view()).toMatchObject({ problems: [], sourceNewer: true, builtAt: old.getTime() });
  });

  it("shows why an upload was refused and stays ready", async () => {
    const dir = await project();
    const { publisher: reviewer } = publisher({ refuse: new UserError("publish.error.dailyLimit") });
    await reviewer.open(dir);
    await reviewer.publish();
    expect(reviewer.view()).toMatchObject({ status: "ready", error: translate("en", "publish.error.dailyLimit"), published: null });
  });

  it("needs a kept key", async () => {
    const dir = await project();
    const { publisher: reviewer } = publisher({ noKey: true });
    await expect(reviewer.open(dir)).rejects.toMatchObject({ key: "publish.error.setup" });
    await expect(reviewer.pack(dir)).rejects.toMatchObject({ key: "publish.error.setup" });
  });

  it("packs for Save as zip", async () => {
    const dir = await project();
    const { publisher: reviewer, owner } = publisher();
    const { manifest, zip } = await reviewer.pack(dir);
    expect(manifest.id).toBe("me.tracker");
    expect(verifyFiles(readZip(zip))).toEqual({ ok: true, owner, signed: true });
  });
});

describe("nextVersions", () => {
  it("counts up from the listed version", () => {
    expect(nextVersions("0.1.0")).toEqual({ patch: "0.1.1", minor: "0.2.0", major: "1.0.0" });
    expect(nextVersions("1.2.0-beta.2")).toEqual({ patch: "1.2.0", minor: "1.3.0", major: "2.0.0" });
  });
});

describe("writeVersion", () => {
  it("makes a changelog when the module has none, and leaves package.json at another version alone", async () => {
    const { changelog: _none, ...manifest } = MANIFEST;
    const dir = await project(manifest);
    await rm(path.join(dir, "changelog.json"));
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "tracker", version: "9.9.9" }));
    await writeVersion(dir, "1.3.0", ["New."], "2026-10-21");
    expect(JSON.parse(await readFile(path.join(dir, "tavora.module.json"), "utf8"))).toMatchObject({ version: "1.3.0", changelog: "changelog.json" });
    expect(JSON.parse(await readFile(path.join(dir, "changelog.json"), "utf8"))).toEqual([{ version: "1.3.0", date: "2026-10-21", notes: ["New."] }]);
    expect(JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")).version).toBe("9.9.9");
  });

  it("replaces the notes of a version listed already, and refuses a changelog it can't read", async () => {
    const dir = await project();
    await writeVersion(dir, "1.2.3", ["Rewritten."], "2026-10-21");
    expect(JSON.parse(await readFile(path.join(dir, "changelog.json"), "utf8"))).toEqual([{ version: "1.2.3", date: "2026-10-21", notes: ["Rewritten."] }]);
    await writeFile(path.join(dir, "changelog.json"), "{ nope");
    await expect(writeVersion(dir, "1.2.4", ["x"], "2026-10-21")).rejects.toMatchObject({ key: "publish.error.badFile" });
    expect(JSON.parse(await readFile(path.join(dir, "tavora.module.json"), "utf8")).version).toBe("1.2.3");
  });
});
