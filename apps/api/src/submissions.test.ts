import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { createHostedStore } from "./hosted-store.ts";
import { IconState } from "./icon-state.ts";
import type { IconEntry, IconStore } from "./icons.ts";
import { encodePng, inspectPng } from "./png.ts";
import { createSubmissions, MAX_PENDING, MAX_PENDING_PER_GAME } from "./submissions.ts";

const picture = (size: number, seed: number) =>
  Uint8Array.from({ length: size * size * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * seed) % 256));
const png = (size = 32, seed = 3) => encodePng(size, size, picture(size, seed));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** The picture with a text chunk slipped in before IEND. */
function withText(file: Uint8Array): Uint8Array {
  const data = new TextEncoder().encode("Comment\0hidden payload");
  const chunk = new Uint8Array(12 + data.byteLength);
  view(chunk).setUint32(0, data.byteLength);
  chunk.set(new TextEncoder().encode("tEXt"), 4);
  chunk.set(data, 8);
  view(chunk).setUint32(8 + data.byteLength, crc32(chunk.subarray(4, 8 + data.byteLength)));
  const out = new Uint8Array(file.byteLength + chunk.byteLength);
  out.set(file.subarray(0, file.byteLength - 12));
  out.set(chunk, file.byteLength - 12);
  out.set(file.subarray(file.byteLength - 12), file.byteLength - 12 + chunk.byteLength);
  return out;
}

/** An .ico with one PNG frame. */
function icoOf(frame: Uint8Array, size = 32): Uint8Array {
  const out = new Uint8Array(22 + frame.byteLength);
  const v = new DataView(out.buffer);
  v.setUint16(2, 1, true);
  v.setUint16(4, 1, true);
  out[6] = size;
  out[7] = size;
  v.setUint32(14, frame.byteLength, true);
  v.setUint32(18, 22, true);
  out.set(frame, 22);
  return out;
}

const GAMES: Record<string, string> = { "diablo-iv": "Diablo IV", "elden-ring": "Elden Ring", "hades-2": "Hades II" };
const seedFiles = new Map<string, { names: string[]; bytes: Uint8Array }>();
const seed: IconStore = {
  list: (): IconEntry[] => [...seedFiles].map(([id, icon]) => ({ id, names: icon.names, sha256: sha(icon.bytes), size: icon.bytes.byteLength })),
  file: (id) => seedFiles.get(id)?.bytes ?? null,
};

let state: IconState;
let store: IconStore;
let submissions: ReturnType<typeof createSubmissions>;
const now = new Date("2026-10-15T12:00:00Z");
beforeEach(() => {
  seedFiles.clear();
  state = new IconState(":memory:");
  store = createHostedStore(seed, state);
  submissions = createSubmissions({ state, store, gameName: (id) => GAMES[id] ?? null, now: () => now });
});

const offer = (over: Record<string, unknown> = {}) => submissions.submit({ id: "diablo-iv", name: "Diablo IV", source: "installed", icon: b64(png()), ...over });

describe("submit", () => {
  it("queues a valid PNG without serving it", () => {
    expect(offer()).toEqual({ status: 202 });
    expect(submissions.listPending()).toEqual([
      expect.objectContaining({ id: "diablo-iv", name: "Diablo IV", gameName: "Diablo IV", source: "installed", count: 1, hasIcon: false, firstSeen: now.toISOString() }),
    ]);
    expect(store.list()).toEqual([]);
    expect(store.file("diablo-iv")).toBeNull();
  });

  it("keeps the picture and drops everything hidden around it", () => {
    const clean = png();
    offer({ icon: b64(withText(clean)) });
    const [row] = state.listPending();
    expect(row!.sha256).toBe(sha(clean));
    const kept = state.pendingBytes(row!.sha256)!;
    expect(kept).toEqual(clean);
    expect(new TextDecoder("latin1").decode(kept)).not.toContain("hidden payload");
    expect(inspectPng(kept)).toEqual({ width: 32, height: 32 });
  });

  it("accepts an .ico and queues its PNG", () => {
    const frame = png();
    expect(offer({ icon: b64(icoOf(frame)) })).toEqual({ status: 202 });
    expect(state.pendingBytes(sha(frame))).toEqual(frame);
  });

  it("counts a repeated offer of the same file instead of keeping a copy", () => {
    offer();
    offer();
    offer();
    expect(submissions.listPending()).toHaveLength(1);
    expect(submissions.listPending()[0]!.count).toBe(3);
  });

  it("takes the game's name and a known source, and falls back for anything else", () => {
    offer({ name: "  ", source: "carrier pigeon" });
    expect(submissions.listPending()[0]).toMatchObject({ name: "Diablo IV", source: "other" });
    state.deletePending(state.listPending()[0]!.sha256);
    offer({ name: "x".repeat(300), source: "steam" });
    expect(submissions.listPending()[0]!.name).toHaveLength(120);
    expect(submissions.listPending()[0]!.source).toBe("steam");
  });

  it("refuses what is not an icon offer, and says why", () => {
    const cases: Array<[Record<string, unknown>, number]> = [
      [{ id: undefined }, 400],
      [{ id: "../x" }, 400],
      [{ id: "Diablo-IV" }, 400],
      [{ icon: undefined }, 400],
      [{ icon: "" }, 400],
      [{ icon: "not base64!!" }, 400],
      [{ icon: b64(new Uint8Array(500).fill(1)) }, 400],
      [{ icon: b64(png(16)) }, 400],
      [{ icon: b64(encodePng(300, 300, picture(300, 3))) }, 400],
      [{ icon: "A".repeat(400_001) }, 413],
      [{ id: "unknown-game" }, 400],
    ];
    for (const [over, status] of cases) expect(offer(over)).toMatchObject({ status });
    expect(offer({ icon: "AAA" })).toMatchObject({ status: 400 });
    expect(submissions.submit(null)).toMatchObject({ status: 400 });
    expect(submissions.submit("text")).toMatchObject({ status: 400 });
    expect(state.pendingCount()).toBe(0);
  });

  it("refuses an icon for a game that already has one", () => {
    seedFiles.set("diablo-iv", { names: ["Diablo IV"], bytes: png(32, 9) });
    expect(offer()).toMatchObject({ status: 409 });
    expect(state.pendingCount()).toBe(0);
  });

  it("quietly keeps nothing of a blocked file, and answers like any other offer", () => {
    const file = png();
    state.block(sha(file), "denied", now);
    expect(offer({ icon: b64(file) })).toEqual({ status: 202 });
    expect(state.pendingCount()).toBe(0);
  });

  it("keeps at most a few different offers per game, and a limited queue overall", () => {
    for (let seedValue = 1; seedValue <= MAX_PENDING_PER_GAME + 3; seedValue += 1) offer({ icon: b64(png(32, seedValue * 2 + 1)) });
    expect(state.pendingCount("diablo-iv")).toBe(MAX_PENDING_PER_GAME);
    // A repeat of one already waiting is still counted.
    offer({ icon: b64(png(32, 3)) });
    expect(state.listPending().find((row) => row.sha256 === sha(png(32, 3)))!.count).toBe(2);

    const full = createSubmissions({ state, store, gameName: (id) => GAMES[id] ?? null, now: () => now });
    for (let i = 0; state.pendingCount() < MAX_PENDING; i += 1) state.addPending({ sha256: `f${i}`.padEnd(64, "0"), id: "elden-ring", name: "x", source: "other", bytes: new Uint8Array(1), now });
    expect(full.submit({ id: "hades-2", name: "Hades II", source: "other", icon: b64(png(32, 77)) })).toMatchObject({ status: 503 });
  });
});

describe("approve, deny and takedown", () => {
  it("publishes an approved offer under the game's own name only, at once, and drops the other offers for that game", () => {
    offer({ name: "Diablo 4" });
    offer({ icon: b64(png(32, 5)), name: "Diablo 4" });
    const first = state.listPending()[0]!;
    expect(submissions.approve(first.sha256)).toEqual({ ok: true, id: "diablo-iv" });
    expect(store.list()).toEqual([expect.objectContaining({ id: "diablo-iv", names: ["Diablo IV"], sha256: first.sha256 })]);
    expect(store.file("diablo-iv")).toEqual(state.approvedBytes("diablo-iv"));
    expect(state.pendingCount()).toBe(0);
  });

  it("refuses to approve what is not waiting, and a second icon for a game that has one", () => {
    expect(submissions.approve("0".repeat(64))).toEqual({ ok: false, error: "No such offer." });
    offer();
    const row = state.listPending()[0]!;
    seedFiles.set("diablo-iv", { names: ["Diablo IV"], bytes: png(32, 9) });
    expect(submissions.approve(row.sha256)).toMatchObject({ ok: false });
    expect(store.file("diablo-iv")).toEqual(png(32, 9));
  });

  it("denies an offer, and with blocking never accepts that file again", () => {
    offer();
    const row = state.listPending()[0]!;
    expect(submissions.deny(row.sha256, false)).toBe(true);
    expect(submissions.deny(row.sha256, false)).toBe(false);
    offer();
    expect(submissions.deny(row.sha256, true)).toBe(true);
    expect(state.pendingCount()).toBe(0);
    offer();
    expect(state.pendingCount()).toBe(0);
    expect(state.isBlocked(row.sha256)).toBe(true);
  });

  it("takes an approved icon down at once, and with blocking refuses the same file again", () => {
    offer();
    const row = state.listPending()[0]!;
    submissions.approve(row.sha256);
    expect(submissions.takedown("diablo-iv", true)).toBe(true);
    expect(store.list()).toEqual([]);
    expect(store.file("diablo-iv")).toBeNull();
    offer();
    expect(state.pendingCount()).toBe(0);
    expect(submissions.takedown("diablo-iv", false)).toBe(false);
  });

  it("takes down an icon that ships with the release, and a replacement never brings the old one back", () => {
    seedFiles.set("diablo-iv", { names: ["Diablo IV"], bytes: png(32, 9) });
    expect(store.list()).toHaveLength(1);
    expect(submissions.takedown("diablo-iv", true)).toBe(true);
    expect(store.list()).toEqual([]);
    expect(store.file("diablo-iv")).toBeNull();

    offer({ icon: b64(png(32, 11)) });
    const row = state.listPending()[0]!;
    expect(submissions.approve(row.sha256)).toEqual({ ok: true, id: "diablo-iv" });
    expect(store.file("diablo-iv")).toEqual(png(32, 11));
    expect(store.list()).toHaveLength(1);

    expect(submissions.takedown("diablo-iv", false)).toBe(true);
    expect(store.list()).toEqual([]);
    expect(store.file("diablo-iv")).toBeNull();
  });

  it("serves release icons and approved ones together, sorted, and takedown of an unknown game is false", () => {
    seedFiles.set("hades-2", { names: ["Hades II"], bytes: png(32, 9) });
    offer();
    submissions.approve(state.listPending()[0]!.sha256);
    expect(store.list().map((icon) => icon.id)).toEqual(["diablo-iv", "hades-2"]);
    expect(submissions.takedown("nothing", false)).toBe(false);
  });
});
