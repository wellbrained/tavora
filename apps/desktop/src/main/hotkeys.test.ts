import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "@tavora/sdk/protocol";
import { HotkeyRegistrar, HotkeyStore, HOTKEYS_FILE, type HotkeyRecord, type ShortcutRegistry } from "./hotkeys";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tavora-hotkeys-"));
});

afterEach(async () => {
  // Saves run in the background; let the last one land first.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

const record = (fields: Partial<HotkeyRecord> = {}): HotkeyRecord => ({
  owner: "official",
  moduleId: "tavora.clock-counter",
  gameId: "poe2",
  action: "start-pause",
  target: "item-1",
  label: "Boss timer",
  accelerator: "Ctrl+Alt+1",
  ...fields,
});

describe("HotkeyStore", () => {
  it("keeps one key per action and target, across a restart", async () => {
    const store = await HotkeyStore.load(dir);
    expect(store.set(record())).toBe(true);
    expect(store.set(record({ accelerator: "F9" }))).toBe(true);
    expect(store.all()).toEqual([record({ accelerator: "F9" })]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await HotkeyStore.load(dir)).all()).toEqual([record({ accelerator: "F9" })]);
  });

  it("finds a key another binding in the same game uses, not one in another game", async () => {
    const store = await HotkeyStore.load(dir);
    store.set(record());
    expect(store.conflict(record({ target: "item-2" }), "Ctrl+Alt+1")).toEqual(record());
    expect(store.conflict(record(), "Ctrl+Alt+1")).toBeUndefined();
    expect(store.conflict(record({ gameId: "elden-ring" }), "Ctrl+Alt+1")).toBeUndefined();
    // A key that works over every game (a general overlay's) collides with any game's key, in either direction.
    const general = (key: { target: string }) => key.target === "wide";
    expect(store.conflict(record({ gameId: "elden-ring", target: "wide" }), "Ctrl+Alt+1", general)).toEqual(record());
    expect(store.conflict(record({ gameId: "elden-ring", target: "narrow" }), "Ctrl+Alt+1", general)).toBeUndefined();
  });

  it("limits the hotkeys of one module in one game", async () => {
    const store = await HotkeyStore.load(dir);
    for (let i = 0; i < LIMITS.maxHotkeys; i++) expect(store.set(record({ target: `t${i}`, accelerator: `F${(i % 24) + 1}` }))).toBe(true);
    expect(store.set(record({ target: "one-more" }))).toBe(false);
    expect(store.set(record({ target: "one-more", gameId: "elden-ring" }))).toBe(true);
  });

  it("drops entries with a key it doesn't take", async () => {
    await writeFile(path.join(dir, HOTKEYS_FILE), JSON.stringify({ version: 1, hotkeys: [record(), record({ target: "x", accelerator: "K" }), { owner: 1 }] }));
    expect((await HotkeyStore.load(dir)).all()).toEqual([record()]);
  });
});

/** A pretend globalShortcut: keys in `held` belong to another program. */
function fakeShortcuts(held: string[] = []) {
  const registered = new Map<string, () => void>();
  const shortcuts: ShortcutRegistry = {
    register: (accelerator, callback) => {
      if (held.includes(accelerator) || registered.has(accelerator)) return false;
      registered.set(accelerator, callback);
      return true;
    },
    unregister: (accelerator) => void registered.delete(accelerator),
  };
  return { shortcuts, registered };
}

describe("HotkeyRegistrar", () => {
  it("registers what should work now and lets go of the rest", () => {
    const { shortcuts, registered } = fakeShortcuts();
    const pressed: HotkeyRecord[] = [];
    const registrar = new HotkeyRegistrar(shortcuts, (hit) => pressed.push(hit));
    registrar.apply([record(), record({ target: "item-2", accelerator: "F9" })]);
    expect([...registered.keys()]).toEqual(["Ctrl+Alt+1", "F9"]);
    registered.get("F9")!();
    expect(pressed).toEqual([record({ target: "item-2", accelerator: "F9" })]);
    expect(registrar.apply([record({ target: "item-2", accelerator: "F9" })])).toBe(true);
    expect([...registered.keys()]).toEqual(["F9"]);
    expect(registrar.apply([record({ target: "item-2", accelerator: "F9" })])).toBe(false);
  });

  it("notes keys another program holds", () => {
    const { shortcuts, registered } = fakeShortcuts(["F9"]);
    const registrar = new HotkeyRegistrar(shortcuts, () => {});
    registrar.apply([record({ accelerator: "F9" })]);
    expect(registered.size).toBe(0);
    expect(registrar.taken.has("F9")).toBe(true);
    registrar.apply([]);
    expect(registrar.taken.size).toBe(0);
  });

  it("lets every key go while paused and puts back what is wanted then", () => {
    const { shortcuts, registered } = fakeShortcuts(["F10"]);
    const registrar = new HotkeyRegistrar(shortcuts, () => {});
    registrar.apply([record()]);
    registrar.pause();
    expect(registered.size).toBe(0);
    expect(registrar.isTaken("Ctrl+Alt+1")).toBe(false);
    expect(registrar.isTaken("F10")).toBe(true);
    registrar.apply([record({ accelerator: "F11" })]);
    expect(registered.size).toBe(0);
    registrar.resume();
    expect([...registered.keys()]).toEqual(["F11"]);
    registrar.clear();
    expect(registered.size).toBe(0);
  });
});
