import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GRANTS_FILE, GrantStore, sanitizeGrants, type GrantSubject } from "./grants";

const KEY = "0123456789abcdef0123456789abcdef";
const NOW = new Date("2026-10-16T20:00:00.000Z");

function subject(network: string[], version = "1.0.0", owner = KEY, id = "community.someone.tracker"): GrantSubject {
  return { owner, manifest: { id, version, permissions: { network } } };
}

async function store(contents?: unknown) {
  const dir = await mkdtemp(path.join(tmpdir(), "tavora-grants-"));
  if (contents !== undefined) await writeFile(path.join(dir, GRANTS_FILE), JSON.stringify(contents));
  return { dir, grants: await GrantStore.load(dir, () => NOW) };
}

describe("GrantStore", () => {
  it("allows nothing before the user grants anything", async () => {
    const { grants } = await store();
    expect(grants.allowed(subject(["api.example.com"]))).toEqual({ network: [], connectors: [], folders: [] });
    expect(grants.missing(subject(["api.example.com"]))).toEqual({ network: ["api.example.com"], connectors: [], folders: [] });
  });

  it("keeps a grant on disk, for the owner and id, with the version answered for", async () => {
    const { dir, grants } = await store();
    await grants.grant(subject(["api.example.com", "cdn.example.com"]));
    expect(JSON.parse(await readFile(path.join(dir, GRANTS_FILE), "utf8"))).toEqual({
      version: 1,
      owners: { [KEY]: { "community.someone.tracker": { version: "1.0.0", grantedAt: NOW.toISOString(), network: ["api.example.com", "cdn.example.com"], connectors: [], folders: [] } } },
    });
    const again = await GrantStore.load(dir);
    expect(again.allowed(subject(["api.example.com", "cdn.example.com"]))).toEqual({ network: ["api.example.com", "cdn.example.com"], connectors: [], folders: [] });
  });

  it("takes a grant back in memory when it can't be saved", async () => {
    const { dir, grants } = await store();
    await grants.grant(subject(["api.example.com"]));
    // A folder where the file goes: the write fails.
    await rm(path.join(dir, GRANTS_FILE));
    await mkdir(path.join(dir, GRANTS_FILE));
    await expect(grants.grant(subject(["api.example.com", "cdn.example.com"]))).rejects.toBeDefined();
    expect(grants.allowed(subject(["api.example.com", "cdn.example.com"]))).toEqual({ network: ["api.example.com"], connectors: [], folders: [] });
    const other = subject(["x.example.com"], "1.0.0", KEY, "community.someone.other");
    await expect(grants.grant(other)).rejects.toBeDefined();
    expect(grants.get(KEY, "community.someone.other")).toBeUndefined();
  });

  it("never covers another publisher's module with the same id", async () => {
    const { grants } = await store();
    await grants.grant(subject(["api.example.com"]));
    expect(grants.allowed(subject(["api.example.com"], "1.0.0", "local"))).toEqual({ network: [], connectors: [], folders: [] });
    expect(grants.allowed(subject(["api.example.com"], "1.0.0", "fedcba9876543210fedcba9876543210"))).toEqual({ network: [], connectors: [], folders: [] });
  });

  it("only grants what the manifest asks for", async () => {
    const { grants } = await store();
    await grants.grant(subject(["api.example.com"]), { network: ["api.example.com", "evil.example.com"], connectors: [], folders: [] });
    expect(grants.get(KEY, "community.someone.tracker")?.network).toEqual(["api.example.com"]);
  });

  it("covers only what the current manifest still asks for", async () => {
    const { grants } = await store();
    await grants.grant(subject(["api.example.com", "old.example.com"]));
    expect(grants.allowed(subject(["api.example.com"], "1.1.0"))).toEqual({ network: ["api.example.com"], connectors: [], folders: [] });
  });

  it("keeps an update's old grants working and lists only what it newly asks for", async () => {
    const { grants } = await store();
    await grants.grant(subject(["api.example.com"]));
    const update = subject(["api.example.com", "new.example.com"], "2.0.0");
    expect(grants.allowed(update)).toEqual({ network: ["api.example.com"], connectors: [], folders: [] });
    expect(grants.missing(update)).toEqual({ network: ["new.example.com"], connectors: [], folders: [] });
    await grants.grant(update, { network: ["new.example.com"], connectors: [], folders: [] });
    expect(grants.get(KEY, update.manifest.id)).toMatchObject({ version: "2.0.0", network: ["api.example.com", "new.example.com"] });
  });

  it("revokes part of a grant or all of it", async () => {
    const { dir, grants } = await store();
    const tracker = subject(["api.example.com", "cdn.example.com"]);
    await grants.grant(tracker);
    await grants.revoke(KEY, tracker.manifest.id, { network: ["cdn.example.com"], connectors: [], folders: [] });
    expect(grants.allowed(tracker)).toEqual({ network: ["api.example.com"], connectors: [], folders: [] });
    await grants.revoke(KEY, tracker.manifest.id);
    expect(grants.allowed(tracker)).toEqual({ network: [], connectors: [], folders: [] });
    expect(JSON.parse(await readFile(path.join(dir, GRANTS_FILE), "utf8"))).toEqual({ version: 1, owners: {} });
  });

  it("forgets the module when its last host is revoked", async () => {
    const { grants } = await store();
    const tracker = subject(["api.example.com"]);
    await grants.grant(tracker);
    await grants.revoke(KEY, tracker.manifest.id, { network: ["api.example.com"], connectors: [], folders: [] });
    expect(grants.get(KEY, tracker.manifest.id)).toBeUndefined();
  });

  it("treats an unreadable file as no grants and keeps it aside", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tavora-grants-"));
    await writeFile(path.join(dir, GRANTS_FILE), "{ not json");
    const grants = await GrantStore.load(dir);
    expect(grants.allowed(subject(["api.example.com"]))).toEqual({ network: [], connectors: [], folders: [] });
  });
});

describe("connector grants", () => {
  const usage = (connectors: ("ai-usage")[], network: string[] = []): GrantSubject => ({
    owner: "official",
    manifest: { id: "tavora.ai-usage", version: "1.0.0", permissions: { network, connectors } },
  });

  it("asks for, grants and revokes a connector like a host", async () => {
    const { grants } = await store();
    expect(grants.missing(usage(["ai-usage"]))).toEqual({ network: [], connectors: ["ai-usage"], folders: [] });
    await grants.grant(usage(["ai-usage"], ["status.example.com"]), { network: [], connectors: ["ai-usage"], folders: [] });
    expect(grants.allowed(usage(["ai-usage"], ["status.example.com"]))).toEqual({ network: [], connectors: ["ai-usage"], folders: [] });
    expect(grants.missing(usage(["ai-usage"], ["status.example.com"]))).toEqual({ network: ["status.example.com"], connectors: [], folders: [] });
    await grants.revoke("official", "tavora.ai-usage", { network: [], connectors: ["ai-usage"], folders: [] });
    expect(grants.get("official", "tavora.ai-usage")).toBeUndefined();
  });

  it("leaves a connector asked for on request out of what is missing, and covers it once granted", async () => {
    const { grants } = await store();
    const clock: GrantSubject = { owner: "official", manifest: { id: "tavora.clock-counter", version: "0.1.0", permissions: { network: [], connectors: ["stream-overlay"], onRequest: ["stream-overlay"] } } };
    expect(grants.missing(clock)).toEqual({ network: [], connectors: [], folders: [] });
    expect(grants.allowed(clock)).toEqual({ network: [], connectors: [], folders: [] });
    await grants.grant(clock, { network: [], connectors: ["stream-overlay"], folders: [] });
    expect(grants.allowed(clock)).toEqual({ network: [], connectors: ["stream-overlay"], folders: [] });
  });

  it("does not cover a connector the manifest no longer asks for", async () => {
    const { grants } = await store();
    await grants.grant(usage(["ai-usage"]));
    expect(grants.allowed(usage([]))).toEqual({ network: [], connectors: [], folders: [] });
  });

  it("reads grants saved before connectors existed", () => {
    const owners = sanitizeGrants({ version: 1, owners: { [KEY]: { "community.someone.tracker": { version: "1.0.0", grantedAt: "x", network: ["api.example.com"] } } } });
    expect(owners.get(KEY)?.get("community.someone.tracker")).toEqual({ version: "1.0.0", grantedAt: "x", network: ["api.example.com"], connectors: [], folders: [] });
  });

  it("drops connectors Tavora does not have", () => {
    const owners = sanitizeGrants({ version: 1, owners: { official: { "tavora.ai-usage": { version: "1.0.0", grantedAt: "x", network: [], connectors: ["ai-usage", "discord", "steam", 7], folders: [] } } } });
    expect(owners.get("official")?.get("tavora.ai-usage")?.connectors).toEqual(["ai-usage", "discord"]);
  });
});

describe("sanitizeGrants", () => {
  it("drops entries with a bad owner, id, host or shape", () => {
    const owners = sanitizeGrants({
      version: 1,
      owners: {
        [KEY]: {
          "community.someone.tracker": { version: "1.0.0", grantedAt: "x", network: ["api.example.com", "localhost", "https://x.example.com", 7] },
          "Bad Id": { version: "1.0.0", grantedAt: "x", network: [] },
          "community.someone.broken": { version: 1, grantedAt: "x", network: [] },
        },
        "../escape": { "community.someone.tracker": { version: "1.0.0", grantedAt: "x", network: ["api.example.com"] } },
      },
    });
    expect([...owners.keys()]).toEqual([KEY]);
    expect([...owners.get(KEY)!.entries()]).toEqual([["community.someone.tracker", { version: "1.0.0", grantedAt: "x", network: ["api.example.com"], connectors: [], folders: [] }]]);
  });

  it("reads nothing from something that is not a grants file", () => {
    expect(sanitizeGrants(null).size).toBe(0);
    expect(sanitizeGrants([]).size).toBe(0);
    expect(sanitizeGrants({ owners: "x" }).size).toBe(0);
  });
});

describe("running while its game runs", () => {
  const panels = [{ id: "history", name: "History", withGame: true }];
  function withGame(version = "1.0.0", asks = true, network: string[] = []): GrantSubject {
    return { owner: KEY, manifest: { id: "community.someone.kings", version, permissions: { network }, ...(asks ? { panels } : {}) } };
  }

  it("is asked with the rest, granted on the yes, and kept with the other grants", async () => {
    const { dir, grants } = await store();
    expect(grants.missing(withGame())).toEqual({ network: [], connectors: [], folders: [], withGame: true });
    expect(grants.allowed(withGame())).toEqual({ network: [], connectors: [], folders: [] });
    await grants.grant(withGame());
    expect(grants.missing(withGame())).toEqual({ network: [], connectors: [], folders: [] });
    expect(grants.allowed(withGame())).toEqual({ network: [], connectors: [], folders: [], withGame: true });
    const again = await GrantStore.load(dir);
    expect(again.get(KEY, "community.someone.kings")?.withGame).toBe(true);
  });

  it("is granted only when the dialog showed it and the manifest asks for it", async () => {
    const { grants } = await store();
    await grants.grant(withGame(), { network: [], connectors: [], folders: [] });
    expect(grants.get(KEY, "community.someone.kings")?.withGame).toBeUndefined();
    await grants.grant(withGame("1.0.0", false), { network: [], connectors: [], folders: [], withGame: true });
    expect(grants.get(KEY, "community.someone.kings")?.withGame).toBeUndefined();
  });

  it("survives an update and covers nothing for a version that no longer asks", async () => {
    const { grants } = await store();
    await grants.grant(withGame());
    expect(grants.allowed(withGame("1.1.0"))).toMatchObject({ withGame: true });
    expect(grants.missing(withGame("1.1.0"))).toEqual({ network: [], connectors: [], folders: [] });
    expect(grants.allowed(withGame("1.2.0", false))).toEqual({ network: [], connectors: [], folders: [] });
  });

  it("switched off stays answered, so it isn't asked again, and on again is allowed", async () => {
    const { grants } = await store();
    await grants.grant(withGame("1.0.0", true, ["api.example.com"]));
    await grants.setWithGame(withGame("1.0.0", true, ["api.example.com"]), false);
    expect(grants.allowed(withGame("1.0.0", true, ["api.example.com"]))).toEqual({ network: ["api.example.com"], connectors: [], folders: [] });
    expect(grants.missing(withGame("1.0.0", true, ["api.example.com"]))).toEqual({ network: [], connectors: [], folders: [] });
    // A later yes to something else doesn't turn it back on.
    await grants.grant(withGame("1.1.0", true, ["api.example.com"]), { network: ["api.example.com"], connectors: [], folders: [] });
    expect(grants.get(KEY, "community.someone.kings")?.withGame).toBe(false);
    await grants.setWithGame(withGame(), true);
    expect(grants.allowed(withGame())).toMatchObject({ withGame: true });
  });

  it("taken back on its own stays answered; taken back with everything goes, and is asked again", async () => {
    const { grants } = await store();
    await grants.grant(withGame());
    await grants.revoke(KEY, "community.someone.kings", { network: [], connectors: [], folders: [], withGame: true });
    expect(grants.get(KEY, "community.someone.kings")?.withGame).toBe(false);
    await grants.revoke(KEY, "community.someone.kings");
    expect(grants.get(KEY, "community.someone.kings")).toBeUndefined();
    expect(grants.missing(withGame())).toMatchObject({ withGame: true });
  });

  it("can't be switched on for a module that doesn't ask for it", async () => {
    const { grants } = await store();
    await grants.setWithGame(withGame("1.0.0", false), true);
    expect(grants.get(KEY, "community.someone.kings")).toBeUndefined();
  });

  it("asks again when the module is made for a game the yes wasn't for", async () => {
    const { grants } = await store();
    const forGames = (games: string[], version = "1.0.0"): GrantSubject => ({ owner: KEY, manifest: { ...withGame(version).manifest, games } });
    await grants.grant(forGames(["9-kings"]));
    expect(grants.get(KEY, "community.someone.kings")?.withGameFor).toEqual(["9-kings"]);
    expect(grants.allowed(forGames(["9-kings"], "1.1.0"))).toMatchObject({ withGame: true });
    // An update made for another game too: not allowed until asked again.
    expect(grants.allowed(forGames(["9-kings", "other"], "1.2.0")).withGame).toBeUndefined();
    expect(grants.missing(forGames(["9-kings", "other"], "1.2.0"))).toMatchObject({ withGame: true });
    await grants.grant(forGames(["9-kings", "other"], "1.2.0"));
    expect(grants.allowed(forGames(["9-kings", "other"], "1.2.0"))).toMatchObject({ withGame: true });
    // Switched on in Settings: for the games it is made for then.
    await grants.setWithGame(forGames(["9-kings", "other"], "1.2.0"), false);
    await grants.setWithGame(forGames(["third"], "1.3.0"), true);
    expect(grants.get(KEY, "community.someone.kings")?.withGameFor).toEqual(["third"]);
  });

  it("forgets the answer when a version drops it, so bringing it back asks again however it is installed", async () => {
    const { grants } = await store();
    await grants.grant(withGame("1.0.0", true, ["api.example.com"]));
    expect(await grants.forgetWithGame(withGame("1.0.0", true, ["api.example.com"]))).toBe(false);
    expect(await grants.forgetWithGame(withGame("1.1.0", false, ["api.example.com"]))).toBe(true);
    expect(grants.get(KEY, "community.someone.kings")).toMatchObject({ network: ["api.example.com"] });
    expect(grants.get(KEY, "community.someone.kings")?.withGame).toBeUndefined();
    expect(grants.missing(withGame("1.2.0", true, ["api.example.com"]))).toMatchObject({ withGame: true });
    expect(await grants.forgetWithGame(withGame("1.1.0", false, ["api.example.com"]))).toBe(false);
  });

  it("reads grants from before it existed, and drops a value that is no answer", () => {
    const read = sanitizeGrants({ owners: { [KEY]: { "community.a.b": { version: "1.0.0", grantedAt: "x", network: [] }, "community.c.d": { version: "1.0.0", grantedAt: "x", network: [], withGame: "yes" } } } });
    expect(read.get(KEY)?.get("community.a.b")).toEqual({ version: "1.0.0", grantedAt: "x", network: [], connectors: [], folders: [] });
    expect(read.get(KEY)?.get("community.c.d")?.withGame).toBeUndefined();
  });
});
