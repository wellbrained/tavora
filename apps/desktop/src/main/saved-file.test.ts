// The save rules of the user's files (saved-versions.ts), tested once here for every store that keeps its file with
// SavedFile: an older Tavora and a newer one taking turns on the same file lose nothing of each other's.
import { mkdirSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onUnreadableFileKept, unreadableFilesKept } from "./json";
import { RawJson, SavedFile, SavedFileHeld, SLOW_TURN_MS, type SavedFileKind } from "./saved-file";

/** The calls of the file system's sync functions a write at quit makes, in order. */
const syncCalls = vi.hoisted(() => [] as string[]);
vi.mock("node:fs", async (original) => {
  const real = await original<typeof import("node:fs")>();
  const noted =
    <A extends unknown[], R>(name: string, call: (...args: A) => R) =>
    (...args: A): R => {
      syncCalls.push(name);
      return call(...args);
    };
  return { ...real, default: real, writeSync: noted("writeSync", real.writeSync), fsyncSync: noted("fsyncSync", real.fsyncSync), renameSync: noted("renameSync", real.renameSync) };
});

/**
 * What comes at the next renames of a written file, one each, in turn: `before` it is tried (it still looks whether it
 * is wanted), or `during` it (it was asked for already: nothing looks again). `landed` says, per rename, whether it went.
 */
const renames = vi.hoisted(() => ({ next: [] as { at: "before" | "during"; run: () => void | Promise<void> }[], landed: [] as boolean[] }));
vi.mock("./rename-held", async (original) => {
  const real = await original<typeof import("./rename-held")>();
  return {
    ...real,
    renameHeld: async (from: string, to: string, waits?: readonly number[], stillWanted?: () => boolean) => {
      const hook = renames.next.shift();
      await hook?.run();
      const landed = await real.renameHeld(from, to, waits, hook?.at === "during" ? undefined : stillWanted);
      renames.landed.push(landed);
      return landed;
    },
  };
});

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-saved-file-"));
  file = path.join(dir, "notes.json");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  renames.next = [];
  renames.landed = [];
});
afterEach(async () => {
  onUnreadableFileKept(null);
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const V1: SavedFileKind = { version: 1, format: "lines" };
const V2: SavedFileKind = { version: 2, format: "lines" };
const text = () => readFile(file, "utf8");
const names = async () => (await readdir(dir)).sort();

describe("reading", () => {
  it("gives null for a missing file, and writes nothing", async () => {
    expect(await new SavedFile(file, V1).read()).toBeNull();
    expect(await names()).toEqual([]);
  });

  it("gives what the file holds", async () => {
    await writeFile(file, '{"version":1,"notes":["a"]}');
    expect(await new SavedFile(file, V1).read()).toEqual({ version: 1, notes: ["a"] });
  });

  it.each([["{ damaged"], ["[1,2]"], ["null"], ['"text"'], [""]])("sets a damaged file aside, tells the user and gives null: %j", async (damaged) => {
    const before = unreadableFilesKept();
    await writeFile(file, damaged);
    expect(await new SavedFile(file, V1).read()).toBeNull();
    const aside = (await names()).filter((name) => name !== "notes.json");
    expect(aside).toEqual([expect.stringMatching(/^notes\.json\.corrupt-\d+$/)]);
    expect(await readFile(path.join(dir, aside[0]!), "utf8")).toBe(damaged);
    expect(unreadableFilesKept()).toBe(before + 1);
  });

  it("sets bookkeeping aside without telling the user", async () => {
    const before = unreadableFilesKept();
    await writeFile(file, "{");
    expect(await new SavedFile(file, { ...V1, notice: false }).read()).toBeNull();
    expect(unreadableFilesKept()).toBe(before);
  });

  it("throws for a file that can't be read right now, and leaves it where it is", async () => {
    await mkdir(file);
    await expect(new SavedFile(file, V1).read()).rejects.toMatchObject({ code: "EISDIR" });
    expect(await names()).toEqual(["notes.json"]);
  });

  it("reads the version from `v` for the sealed files", async () => {
    const newer = '{"v":2,"data":"x"}';
    await writeFile(file, newer);
    await new SavedFile(file, { ...V1, versionKey: "v" }).read();
    expect(await readFile(`${file}.from-version-2`, "utf8")).toBe(newer);
  });
});

describe("writing", () => {
  it("writes the version first, then the store's fields", async () => {
    await new SavedFile(file, V1).write({ notes: ["a"], open: true });
    expect(await text()).toBe(`${JSON.stringify({ version: 1, notes: ["a"], open: true }, null, 2)}\n`);
  });

  it.each([
    ["lines", (value: unknown) => `${JSON.stringify(value, null, 2)}\n`],
    ["indented", (value: unknown) => JSON.stringify(value, null, 2)],
    ["compact", (value: unknown) => JSON.stringify(value)],
  ] as const)("writes %s exactly as JSON.stringify does", async (format, stringify) => {
    const fields = {
      text: 'quote " and \\ and \n and ü 😀',
      nested: { list: [1, [2, [3, {}]], [], { deep: { deeper: [null, true, false, 0.5, -1e21] } }], empty: {} },
      skipped: undefined,
      dropped: () => 1,
      when: new Date(0),
      last: null,
    };
    await new SavedFile(file, { version: 3, format }).write(fields);
    expect(await text()).toBe(stringify({ version: 3, ...fields }));
  });

  it("puts its own version in place of one the store gives, where the store put it", async () => {
    await new SavedFile(file, { version: 2, format: "compact" }).write({ before: 1, version: 7, after: 2 });
    expect(await text()).toBe('{"before":1,"version":2,"after":2}');
  });

  it("refuses a list where the fields belong", async () => {
    const saved = new SavedFile(file, V1);
    // @ts-expect-error A list would be written as a record of its indexes.
    const listed = saved.write(["a"]);
    await expect(listed).rejects.toThrow();
    // @ts-expect-error The same for what update writes.
    await expect(saved.update(() => [1, 2])).rejects.toThrow();
    // @ts-expect-error And for a write at quit, which only answers false.
    expect(saved.writeNow(["a"])).toBe(false);
    expect(await names()).toEqual([]);
  });

  it("writes JSON already serialized as it is, in a compact file", async () => {
    await new SavedFile(file, { version: 1, format: "compact" }).write({ title: "a", data: new RawJson('{"b": 1}') });
    expect(await text()).toBe('{"version":1,"title":"a","data":{"b": 1}}');
    await expect(new SavedFile(file, V1).write({ data: new RawJson("1") })).rejects.toThrow();
  });

  it("takes the fields as they are when asked, not when the write runs", async () => {
    const saved = new SavedFile(file, V1);
    const notes = ["a"];
    const first = saved.write({ notes });
    notes.push("b");
    await first;
    expect(JSON.parse(await text())).toEqual({ version: 1, notes: ["a"] });
  });

  it("writes one at a time, in the order asked, whichever SavedFile of the file asks", async () => {
    const one = new SavedFile(file, V1);
    const other = new SavedFile(file, V1);
    const writes = Array.from({ length: 20 }, (_, n) => (n % 2 ? one : other).write({ n, padding: "x".repeat(n % 3 === 0 ? 100_000 : 1) }));
    await Promise.all(writes);
    expect(JSON.parse(await text())).toMatchObject({ n: 19 });
    expect(await names()).toEqual(["notes.json"]);
  });

  it("goes on with the next write when one fails", async () => {
    const folder = path.join(dir, "sub");
    const saved = new SavedFile(path.join(folder, "notes.json"), V1);
    expect(await saved.read()).toBeNull();
    // A file where its folder should be: the write can't make the folder.
    await writeFile(folder, "in the way");
    await expect(saved.write({ a: 1 })).rejects.toThrow();
    await rm(folder);
    await saved.write({ a: 2 });
    expect(JSON.parse(await readFile(path.join(folder, "notes.json"), "utf8"))).toEqual({ version: 1, a: 2 });
  });

  it("flush waits for every write asked for so far", async () => {
    const saved = new SavedFile(file, V1);
    void saved.write({ a: 1 });
    void saved.write({ a: 2 });
    await saved.flush();
    expect(JSON.parse(await text())).toEqual({ version: 1, a: 2 });
  });
});

describe("a file that can't be read right now is never written over", () => {
  it("refuses every write after a read that failed", async () => {
    await mkdir(file);
    const saved = new SavedFile(file, V1);
    await expect(saved.read()).rejects.toThrow();
    await rm(file, { recursive: true });
    // The file is back (or readable again), but this store never read it: its write would lose what is in it.
    await writeFile(file, '{"version":1,"notes":["kept"]}');
    await expect(saved.write({ notes: [] })).rejects.toBeInstanceOf(SavedFileHeld);
    expect(saved.writeNow({ notes: [] })).toBe(false);
    expect(await text()).toBe('{"version":1,"notes":["kept"]}');
  });

  it("writes again once a read succeeds", async () => {
    await mkdir(file);
    const saved = new SavedFile(file, V1);
    await expect(saved.read()).rejects.toThrow();
    await rm(file, { recursive: true });
    expect(await saved.read()).toBeNull();
    await saved.write({ notes: [] });
    expect(JSON.parse(await text())).toEqual({ version: 1, notes: [] });
  });

  it("refuses a first write when the read it does first fails, and reads again at the next one", async () => {
    await mkdir(file);
    const saved = new SavedFile(file, V1);
    await expect(saved.write({ notes: [] })).rejects.toBeInstanceOf(SavedFileHeld);
    expect(await names()).toEqual(["notes.json"]);
    // Nothing the store has came from that read: once the file can be read, the next write goes through.
    await rm(file, { recursive: true });
    await writeFile(file, '{"version":2,"notes":["newer"]}');
    await saved.write({ notes: ["mine"] });
    expect(JSON.parse(await text())).toEqual({ version: 1, notes: ["mine"] });
    expect(JSON.parse(await readFile(`${file}.from-version-2`, "utf8"))).toEqual({ version: 2, notes: ["newer"] });
  });

  it("update leaves it as it is", async () => {
    await mkdir(file);
    const change = vi.fn(() => ({ notes: [] }));
    await expect(new SavedFile(file, V1).update(change)).rejects.toThrow();
    expect(change).not.toHaveBeenCalled();
  });
});

describe("an older Tavora and a newer one taking turns", () => {
  it("the older one copies the newer one's file aside before it writes, and reads it as far as it understands it", async () => {
    await new SavedFile(file, V2).write({ notes: ["a"], tags: ["new"] });
    const newer = await text();
    const older = new SavedFile(file, V1);
    expect(await older.read()).toEqual({ version: 2, notes: ["a"], tags: ["new"] });
    await older.write({ notes: ["a", "b"] });
    expect(await readFile(`${file}.from-version-2`, "utf8")).toBe(newer);
    expect(JSON.parse(await text())).toEqual({ version: 1, notes: ["a", "b"] });
    // The newer one opens what the older one wrote.
    expect(await new SavedFile(file, V2).read()).toEqual({ version: 1, notes: ["a", "b"] });
  });

  it("a write without a read first still copies the newer file aside", async () => {
    await new SavedFile(file, V2).write({ notes: ["a"] });
    const newer = await text();
    await new SavedFile(file, V1).write({ notes: [] });
    expect(await readFile(`${file}.from-version-2`, "utf8")).toBe(newer);
  });

  it("copies the same file aside once, and a newer file written again since under a name of its own", async () => {
    const older = new SavedFile(file, V1);
    await new SavedFile(file, V2).write({ n: 1 });
    await older.read();
    await older.read();
    await new SavedFile(file, V2).write({ n: 2 });
    await older.read();
    expect((await names()).filter((name) => name.includes("from-version"))).toEqual(["notes.json.from-version-2", "notes.json.from-version-2.2"]);
    expect(JSON.parse(await readFile(`${file}.from-version-2.2`, "utf8"))).toEqual({ version: 2, n: 2 });
  });

  it("a kind that keeps unknown fields writes the newer one's back as they were, right after the version", async () => {
    const kind = (version: number): SavedFileKind => ({ version, format: "compact", keep: { known: ["entries"] } });
    await new SavedFile(file, kind(2)).write({ shared: { a: 1 }, entries: { x: 1 } });
    const older = new SavedFile(file, kind(1));
    await older.read();
    await older.write({ entries: { x: 2 } });
    expect(await text()).toBe('{"version":1,"shared":{"a":1},"entries":{"x":2}}');
    expect(await new SavedFile(file, kind(2)).read()).toEqual({ version: 1, shared: { a: 1 }, entries: { x: 2 } });
  });

  it("puts them before the field the kind names, and never over a field of the store's own", async () => {
    const kind: SavedFileKind = { version: 1, format: "compact", keep: { known: ["owner", "value"], before: "value" } };
    await writeFile(file, '{"version":2,"value":1,"theme":"dark","owner":"old"}');
    const saved = new SavedFile(file, kind);
    await saved.read();
    await saved.write({ owner: "me", value: 2 });
    expect(await text()).toBe('{"version":1,"owner":"me","theme":"dark","value":2}');
    await saved.write({ owner: "me", theme: "light", value: 3 });
    expect(await text()).toBe('{"version":1,"owner":"me","theme":"light","value":3}');
  });

  it("a kind that doesn't keep them writes only the store's own fields", async () => {
    await writeFile(file, '{"version":2,"notes":[],"theme":"dark"}');
    const saved = new SavedFile(file, V1);
    await saved.read();
    await saved.write({ notes: ["a"] });
    expect(JSON.parse(await text())).toEqual({ version: 1, notes: ["a"] });
  });

  it("forgets them when the file is read again without them", async () => {
    const kind: SavedFileKind = { version: 1, format: "compact", keep: { known: ["entries"] } };
    await writeFile(file, '{"version":2,"theme":"dark","entries":{}}');
    const saved = new SavedFile(file, kind);
    await saved.read();
    await writeFile(file, '{"version":1,"entries":{}}');
    await saved.read();
    await saved.write({ entries: { a: 1 } });
    expect(await text()).toBe('{"version":1,"entries":{"a":1}}');
  });
});

describe("update", () => {
  it("reads and writes in one turn, so changes from two places at once all land", async () => {
    const count = (saved: Record<string, unknown> | null) => ({ count: ((saved?.count as number | undefined) ?? 0) + 1 });
    await Promise.all(Array.from({ length: 25 }, () => new SavedFile(file, V1).update(count)));
    expect(JSON.parse(await text())).toEqual({ version: 1, count: 25 });
  });

  it("leaves the file as it is when the change answers null", async () => {
    await writeFile(file, '{"version":1,"a":1}');
    await new SavedFile(file, V1).update(() => null);
    expect(await text()).toBe('{"version":1,"a":1}');
  });

  it("copies a newer file aside before it writes", async () => {
    await new SavedFile(file, V2).write({ a: 1 });
    const newer = await text();
    await new SavedFile(file, V1).update((saved) => ({ a: (saved?.a as number) + 1 }));
    expect(await readFile(`${file}.from-version-2`, "utf8")).toBe(newer);
    expect(JSON.parse(await text())).toEqual({ version: 1, a: 2 });
  });
});

describe("writeNow, for the moment Tavora quits", () => {
  it("writes at once after a read", async () => {
    const saved = new SavedFile(file, V1);
    await saved.read();
    expect(saved.writeNow({ a: 1 })).toBe(true);
    expect(await text()).toBe(`${JSON.stringify({ version: 1, a: 1 }, null, 2)}\n`);
    expect(await names()).toEqual(["notes.json"]);
  });

  it("takes the place of a write asked for before it, still waiting", async () => {
    const saved = new SavedFile(file, V1);
    await saved.read();
    const earlier = saved.write({ a: "older" });
    expect(saved.writeNow({ a: "at quit" })).toBe(true);
    await earlier;
    await saved.flush();
    // The older one is never even tried.
    expect(renames.landed).toEqual([]);
    expect(JSON.parse(await text())).toEqual({ version: 1, a: "at quit" });
    expect(await names()).toEqual(["notes.json"]);
  });

  it("never puts a write being made in place, not even for a moment, once it came", async () => {
    const saved = new SavedFile(file, V1);
    await saved.read();
    renames.next = [{ at: "before", run: () => void saved.writeNow({ a: "at quit" }) }];
    await saved.write({ a: "older" });
    expect(renames.landed).toEqual([false]);
    expect(JSON.parse(await text())).toEqual({ version: 1, a: "at quit" });
    expect(await names()).toEqual(["notes.json"]);
  });

  it("writes the newest of its texts again over a write that went in place while they were made, at once", async () => {
    const saved = new SavedFile(file, V1);
    await saved.read();
    // Two writes at quit while the older write's rename is under way: it lands after both.
    renames.next = [
      {
        at: "during",
        run: () => {
          expect(saved.writeNow({ a: "first" })).toBe(true);
          expect(saved.writeNow({ a: "second" })).toBe(true);
        },
      },
    ];
    await saved.write({ a: "older" });
    expect(renames.landed).toEqual([true]);
    // Written again before the write's turn ended, so nothing can come between.
    expect(JSON.parse(await text())).toEqual({ version: 1, a: "second" });
  });

  it("flushes its text to the disk before it puts it in place", async () => {
    const saved = new SavedFile(file, V1);
    await saved.read();
    syncCalls.length = 0;
    expect(saved.writeNow({ a: 1 })).toBe(true);
    expect(syncCalls).toEqual(["writeSync", "fsyncSync", "renameSync"]);
  });

  it("says so when it can't write its text again over a write that went in place meanwhile", async () => {
    const logged = vi.mocked(console.error);
    const saved = new SavedFile(file, V1);
    await saved.read();
    renames.next = [
      {
        at: "during",
        run: () => {
          saved.writeNow({ a: "at quit" });
          // A folder where its temp goes: written again, it can't be.
          mkdirSync(`${file}.now`);
        },
      },
    ];
    await saved.write({ a: "older" });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("couldn't write notes.json again"));
  });

  it("takes the place of nothing when it fails: a write waiting still lands", async () => {
    const saved = new SavedFile(file, V1);
    await saved.read();
    // A folder where its own temp goes: the write at quit can't be made.
    await mkdir(`${file}.now`);
    const waiting = saved.write({ a: "newer" });
    expect(saved.writeNow({ a: "at quit" })).toBe(false);
    await waiting;
    expect(JSON.parse(await text())).toEqual({ version: 1, a: "newer" });
  });

  it("lets a write asked for after it land", async () => {
    const saved = new SavedFile(file, V1);
    await saved.read();
    saved.writeNow({ a: "at quit" });
    await saved.write({ a: "later" });
    expect(JSON.parse(await text())).toEqual({ version: 1, a: "later" });
  });

  it("writes nothing before a read, as it can't copy a newer file aside first", async () => {
    await writeFile(file, '{"version":2}');
    expect(new SavedFile(file, V1).writeNow({ a: 1 })).toBe(false);
    expect(await text()).toBe('{"version":2}');
  });
});

describe("a turn that takes long", () => {
  /** Lets real file work go on while the timers are fake. */
  const settle = async (until: () => boolean) => {
    for (let n = 0; n < 500 && !until(); n++) await new Promise((resolve) => setImmediate(resolve));
    expect(until()).toBe(true);
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is noted in the log once, and still goes on in its place: the next turn waits for it", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const saved = new SavedFile(file, V1);
    await saved.read();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    renames.next = [{ at: "before", run: () => held }];
    const slow = saved.write({ a: "slow" });
    const next = saved.write({ a: "next" });
    await settle(() => renames.next.length === 0);
    await vi.advanceTimersByTimeAsync(SLOW_TURN_MS * 3);
    expect(warned).toHaveBeenCalledTimes(1);
    expect(warned).toHaveBeenCalledWith(`[tavora] ${file} still being saved after 30 s`);
    // Nothing gave up: the next write still waits, and the slow one lands first.
    expect(renames.landed).toEqual([]);
    release();
    await slow;
    await next;
    expect(renames.landed).toEqual([true, true]);
    expect(JSON.parse(await text())).toEqual({ version: 1, a: "next" });
    expect(warned).toHaveBeenCalledTimes(1);
  });

  it("leaves no timer behind, and says nothing, once a turn ends in time", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const saved = new SavedFile(file, V1);
    await saved.write({ a: 1 });
    await saved.read();
    await expect(saved.update(() => {
      throw new Error("refused");
    })).rejects.toThrow("refused");
    await saved.flush();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(SLOW_TURN_MS * 2);
    expect(warned).not.toHaveBeenCalled();
  });
});

describe("look, and a kind left in place", () => {
  const PLACED: SavedFileKind = { version: 1, versionKey: "v", format: "compact", notice: false, leaveInPlace: true };
  const parse = (saved: Record<string, unknown>) => (typeof saved.note === "string" ? saved.note : null);

  it("tells present, missing and held apart, as file-look.ts does", async () => {
    const saved = new SavedFile(file, PLACED);
    expect(await saved.look(parse)).toEqual({ status: "missing" });
    await writeFile(file, '{"v":1,"note":"hi"}');
    expect(await saved.look(parse)).toEqual({ status: "present", value: "hi" });
    await rm(file);
    await mkdir(file);
    expect(await saved.look(parse)).toMatchObject({ status: "held" });
    // Held, it isn't written over.
    await rm(file, { recursive: true });
    await expect(saved.write({ note: "mine" })).rejects.toBeInstanceOf(SavedFileHeld);
  });

  it("leaves a damaged one where it is, with a copy aside, reads it as damaged, and writes over it then", async () => {
    const saved = new SavedFile(file, PLACED);
    const kept = unreadableFilesKept();
    await writeFile(file, "{ damaged");
    expect(await saved.look(parse)).toMatchObject({ status: "held", error: expect.objectContaining({ name: "Error", message: `${file} is damaged` }) });
    expect(await text()).toBe("{ damaged");
    expect(await readFile(`${file}.corrupt`, "utf8")).toBe("{ damaged");
    // One the store can't use is damaged too.
    await writeFile(file, '{"v":1}');
    expect((await saved.look(parse)).status).toBe("held");
    expect(await readFile(`${file}.corrupt.2`, "utf8")).toBe('{"v":1}');
    // Read again, the same file makes no new copy.
    await saved.look(parse);
    expect((await names()).filter((name) => name.includes(".corrupt"))).toHaveLength(2);
    expect(unreadableFilesKept()).toBe(kept);
    await saved.write({ note: "fresh" });
    expect(await text()).toBe('{"v":1,"note":"fresh"}');
  });

  it("copies a newer one aside once, and reads it as far as the store understands it", async () => {
    const saved = new SavedFile(file, PLACED);
    await writeFile(file, '{"v":2,"note":"newer","more":1}');
    expect(await saved.look(parse)).toEqual({ status: "present", value: "newer" });
    await writeFile(file, '{"v":2,"other":true}');
    expect((await saved.look(parse)).status).toBe("held");
    // A copy aside for each, never a `.corrupt` one besides.
    expect((await names()).sort()).toEqual(["notes.json", "notes.json.from-version-2", "notes.json.from-version-2.2"]);
  });

  it("a kind set aside reads a file it can't use as missing", async () => {
    const saved = new SavedFile(file, { version: 1, versionKey: "v", format: "compact", notice: false });
    await writeFile(file, '{"v":1}');
    expect(await saved.look(parse)).toEqual({ status: "missing" });
    expect((await names()).some((name) => name.startsWith("notes.json.corrupt-"))).toBe(true);
  });
});

describe("remove", () => {
  it("removes after the writes asked before, and reads first, so a newer one is copied aside", async () => {
    await writeFile(file, '{"version":2,"notes":["newer"]}');
    const saved = new SavedFile(file, V1);
    const writing = saved.write({ notes: ["mine"] });
    await saved.remove();
    await writing;
    expect(await names()).toEqual(["notes.json.from-version-2"]);
  });

  it("is refused like a write while the file can't be read", async () => {
    await mkdir(file);
    const saved = new SavedFile(file, V1);
    await expect(saved.read()).rejects.toThrow();
    await rm(file, { recursive: true });
    await writeFile(file, '{"version":1,"notes":["kept"]}');
    await expect(saved.remove()).rejects.toBeInstanceOf(SavedFileHeld);
    expect(await text()).toBe('{"version":1,"notes":["kept"]}');
  });
});
