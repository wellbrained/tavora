import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
    expect(grants.allowed(subject(["api.example.com"]))).toEqual({ network: [], connectors: [] });
    expect(grants.missing(subject(["api.example.com"]))).toEqual({ network: ["api.example.com"], connectors: [] });
  });

  it("keeps a grant on disk, for the owner and id, with the version answered for", async () => {
    const { dir, grants } = await store();
    await grants.grant(subject(["api.example.com", "cdn.example.com"]));
    expect(JSON.parse(await readFile(path.join(dir, GRANTS_FILE), "utf8"))).toEqual({
      version: 1,
      owners: { [KEY]: { "community.someone.tracker": { version: "1.0.0", grantedAt: NOW.toISOString(), network: ["api.example.com", "cdn.example.com"], connectors: [] } } },
    });
    const again = await GrantStore.load(dir);
    expect(again.allowed(subject(["api.example.com", "cdn.example.com"]))).toEqual({ network: ["api.example.com", "cdn.example.com"], connectors: [] });
  });

  it("never covers another publisher's module with the same id", async () => {
    const { grants } = await store();
    await grants.grant(subject(["api.example.com"]));
    expect(grants.allowed(subject(["api.example.com"], "1.0.0", "local"))).toEqual({ network: [], connectors: [] });
    expect(grants.allowed(subject(["api.example.com"], "1.0.0", "fedcba9876543210fedcba9876543210"))).toEqual({ network: [], connectors: [] });
  });

  it("only grants what the manifest asks for", async () => {
    const { grants } = await store();
    await grants.grant(subject(["api.example.com"]), { network: ["api.example.com", "evil.example.com"], connectors: [] });
    expect(grants.get(KEY, "community.someone.tracker")?.network).toEqual(["api.example.com"]);
  });

  it("covers only what the current manifest still asks for", async () => {
    const { grants } = await store();
    await grants.grant(subject(["api.example.com", "old.example.com"]));
    expect(grants.allowed(subject(["api.example.com"], "1.1.0"))).toEqual({ network: ["api.example.com"], connectors: [] });
  });

  it("keeps an update's old grants working and lists only what it newly asks for", async () => {
    const { grants } = await store();
    await grants.grant(subject(["api.example.com"]));
    const update = subject(["api.example.com", "new.example.com"], "2.0.0");
    expect(grants.allowed(update)).toEqual({ network: ["api.example.com"], connectors: [] });
    expect(grants.missing(update)).toEqual({ network: ["new.example.com"], connectors: [] });
    await grants.grant(update, { network: ["new.example.com"], connectors: [] });
    expect(grants.get(KEY, update.manifest.id)).toMatchObject({ version: "2.0.0", network: ["api.example.com", "new.example.com"] });
  });

  it("revokes part of a grant or all of it", async () => {
    const { dir, grants } = await store();
    const tracker = subject(["api.example.com", "cdn.example.com"]);
    await grants.grant(tracker);
    await grants.revoke(KEY, tracker.manifest.id, { network: ["cdn.example.com"], connectors: [] });
    expect(grants.allowed(tracker)).toEqual({ network: ["api.example.com"], connectors: [] });
    await grants.revoke(KEY, tracker.manifest.id);
    expect(grants.allowed(tracker)).toEqual({ network: [], connectors: [] });
    expect(JSON.parse(await readFile(path.join(dir, GRANTS_FILE), "utf8"))).toEqual({ version: 1, owners: {} });
  });

  it("forgets the module when its last host is revoked", async () => {
    const { grants } = await store();
    const tracker = subject(["api.example.com"]);
    await grants.grant(tracker);
    await grants.revoke(KEY, tracker.manifest.id, { network: ["api.example.com"], connectors: [] });
    expect(grants.get(KEY, tracker.manifest.id)).toBeUndefined();
  });

  it("treats an unreadable file as no grants and keeps it aside", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tavora-grants-"));
    await writeFile(path.join(dir, GRANTS_FILE), "{ not json");
    const grants = await GrantStore.load(dir);
    expect(grants.allowed(subject(["api.example.com"]))).toEqual({ network: [], connectors: [] });
  });
});

describe("connector grants", () => {
  const usage = (connectors: ("ai-usage")[], network: string[] = []): GrantSubject => ({
    owner: "official",
    manifest: { id: "tavora.ai-usage", version: "1.0.0", permissions: { network, connectors } },
  });

  it("asks for, grants and revokes a connector like a host", async () => {
    const { grants } = await store();
    expect(grants.missing(usage(["ai-usage"]))).toEqual({ network: [], connectors: ["ai-usage"] });
    await grants.grant(usage(["ai-usage"], ["status.example.com"]), { network: [], connectors: ["ai-usage"] });
    expect(grants.allowed(usage(["ai-usage"], ["status.example.com"]))).toEqual({ network: [], connectors: ["ai-usage"] });
    expect(grants.missing(usage(["ai-usage"], ["status.example.com"]))).toEqual({ network: ["status.example.com"], connectors: [] });
    await grants.revoke("official", "tavora.ai-usage", { network: [], connectors: ["ai-usage"] });
    expect(grants.get("official", "tavora.ai-usage")).toBeUndefined();
  });

  it("leaves a connector asked for on request out of what is missing, and covers it once granted", async () => {
    const { grants } = await store();
    const clock: GrantSubject = { owner: "official", manifest: { id: "tavora.clock-counter", version: "0.1.0", permissions: { network: [], connectors: ["stream-overlay"], onRequest: ["stream-overlay"] } } };
    expect(grants.missing(clock)).toEqual({ network: [], connectors: [] });
    expect(grants.allowed(clock)).toEqual({ network: [], connectors: [] });
    await grants.grant(clock, { network: [], connectors: ["stream-overlay"] });
    expect(grants.allowed(clock)).toEqual({ network: [], connectors: ["stream-overlay"] });
  });

  it("does not cover a connector the manifest no longer asks for", async () => {
    const { grants } = await store();
    await grants.grant(usage(["ai-usage"]));
    expect(grants.allowed(usage([]))).toEqual({ network: [], connectors: [] });
  });

  it("reads grants saved before connectors existed", () => {
    const owners = sanitizeGrants({ version: 1, owners: { [KEY]: { "community.someone.tracker": { version: "1.0.0", grantedAt: "x", network: ["api.example.com"] } } } });
    expect(owners.get(KEY)?.get("community.someone.tracker")).toEqual({ version: "1.0.0", grantedAt: "x", network: ["api.example.com"], connectors: [] });
  });

  it("drops connectors Tavora does not have", () => {
    const owners = sanitizeGrants({ version: 1, owners: { official: { "tavora.ai-usage": { version: "1.0.0", grantedAt: "x", network: [], connectors: ["ai-usage", "discord", "steam", 7] } } } });
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
    expect([...owners.get(KEY)!.entries()]).toEqual([["community.someone.tracker", { version: "1.0.0", grantedAt: "x", network: ["api.example.com"], connectors: [] }]]);
  });

  it("reads nothing from something that is not a grants file", () => {
    expect(sanitizeGrants(null).size).toBe(0);
    expect(sanitizeGrants([]).size).toBe(0);
    expect(sanitizeGrants({ owners: "x" }).size).toBe(0);
  });
});
