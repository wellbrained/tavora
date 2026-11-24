import { mkdir, mkdtemp, readdir, readFile, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
// cutOff: the rename never happens, as when Tavora is stopped right before it.
const cutOff = vi.hoisted(() => ({ value: false }));
vi.mock("./rename-held", async (original) => {
  const actual = await original<typeof import("./rename-held")>();
  return { renameHeld: (from: string, to: string) => (cutOff.value ? new Promise<void>(() => undefined) : actual.renameHeld(from, to)) };
});

import { LEFTOVER_TEMP_AGE_MS, SerialQueue, settleSerial, sweepWriteLeftovers, writeFileAtomic } from "./fsutil";

let root: string;
const now = Date.now();
const old = (now - LEFTOVER_TEMP_AGE_MS - 60_000) / 1000;

/** Writes `name` under root, dated an hour and a minute ago unless `fresh`. */
async function put(name: string, body = "x", fresh = false): Promise<string> {
  const file = path.join(root, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
  if (!fresh) await utimes(file, old, old);
  return file;
}

async function names(dir = root): Promise<string[]> {
  return (await readdir(dir, { recursive: true })).map((name) => name.split(path.sep).join("/")).sort();
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "tavora-fsutil-"));
});

describe("sweepWriteLeftovers", () => {
  it("removes an old temp of an interrupted write and keeps the file it was for", async () => {
    await put("library.json", "{}");
    await put("library.json.0123456789ab.tmp", "{half");
    await put("module-data/tavora.notes/state.json", "{}");
    await put("module-data/tavora.notes/state.json.abcdefabcdef.tmp");

    const removed = await sweepWriteLeftovers(root, () => now);

    expect(removed).toHaveLength(2);
    expect(await names()).toEqual(["library.json", "module-data", "module-data/tavora.notes", "module-data/tavora.notes/state.json"]);
    expect(await readFile(path.join(root, "library.json"), "utf8")).toBe("{}");
  });

  it("removes the old temp of a write at quit cut off, next to its file, and leaves a fresh one", async () => {
    await put("connection.json", "{}");
    await put("connection.json.now", "{half");
    await put("traffic.json", "{}");
    await put("traffic.json.now", "{half", true);
    await put("orphan.json.now", "{only copy");

    expect(await sweepWriteLeftovers(root, () => now)).toEqual([path.join(root, "connection.json.now")]);
    expect(await names()).toEqual(["connection.json", "orphan.json.now", "traffic.json", "traffic.json.now"]);
  });

  it("leaves a temp a running write may still own", async () => {
    await put("library.json");
    await put("library.json.0123456789ab.tmp", "x", true);
    expect(await sweepWriteLeftovers(root, () => now)).toEqual([]);
    expect(await names()).toContain("library.json.0123456789ab.tmp");
  });

  it("leaves a temp dated in the future", async () => {
    await put("b.json");
    await put("b.json.0123456789ab.tmp");
    const future = (now + 24 * 3_600_000) / 1000;
    await utimes(path.join(root, "b.json.0123456789ab.tmp"), future, future);
    expect(await sweepWriteLeftovers(root, () => now)).toEqual([]);
  });

  it("reads the clock for each temp it looks at, not once for the whole sweep", async () => {
    for (const name of ["a", "b", "c"]) {
      await put(`${name}.json`);
      await put(`${name}.json.0123456789ab.tmp`);
    }
    const clock = vi.fn(() => now);
    expect(await sweepWriteLeftovers(root, clock)).toHaveLength(3);
    expect(clock).toHaveBeenCalledTimes(3);
  });

  it("keeps a temp whose file is missing, as it may be the only copy", async () => {
    await put("workspace.json.0123456789ab.tmp", "{}");
    expect(await sweepWriteLeftovers(root, () => now)).toEqual([]);
    expect(await names()).toEqual(["workspace.json.0123456789ab.tmp"]);
  });

  it("removes only the exact temp name", async () => {
    await put("a.json");
    const kept = ["a.json.tmp", "a.json.0123456789.tmp", "a.json.0123456789ABCD.tmp", "a.json.0123456789AB.tmp", "a.json.0123456789ab.tmp.bak", "a.json.0123456789abc.tmp"];
    for (const name of kept) await put(name);
    expect(await sweepWriteLeftovers(root, () => now)).toEqual([]);
    expect(await names()).toEqual(["a.json", ...kept].sort());
  });

  it("sweeps only Tavora's own data folders, never module code, the user's files, Chromium's or a new one", async () => {
    const own = ["panel-state", "game-icons", "steam-icons", "profile", "overlay-pictures", "read-only-files/local.dev/local.x/9-kings", "backups/before-x"];
    for (const dir of own) {
      await put(`${dir}/f.json`);
      await put(`${dir}/f.json.0123456789ab.tmp`);
    }
    expect(await sweepWriteLeftovers(root, () => now)).toHaveLength(own.length);
    for (const dir of ["modules/local.x", "module-staging", "module-blobs/_app", "official-updates/x", "cloud-copy-staging", "Partitions/x", "Local Storage", "blob_storage", "some-new-folder", "logs"]) {
      await put(`${dir}/f.json`);
      await put(`${dir}/f.json.0123456789ab.tmp`);
    }
    expect(await sweepWriteLeftovers(root, () => now)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("never follows or removes a link", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "tavora-fsutil-outside-"));
    await writeFile(path.join(outside, "f.json"), "x");
    await writeFile(path.join(outside, "f.json.0123456789ab.tmp"), "x");
    await utimes(path.join(outside, "f.json.0123456789ab.tmp"), old, old);
    await symlink(outside, path.join(root, "linked"));
    await put("g.json");
    await symlink(path.join(outside, "f.json.0123456789ab.tmp"), path.join(root, "g.json.0123456789ab.tmp"));

    expect(await sweepWriteLeftovers(root, () => now)).toEqual([]);
    expect(await names(outside)).toEqual(["f.json", "f.json.0123456789ab.tmp"]);
  });

  it("removes the temp of a writeFileAtomic cut off before its rename", async () => {
    await put("f.json", "{}");
    cutOff.value = true;
    void writeFileAtomic(path.join(root, "f.json"), "{new}");
    await vi.waitFor(async () => expect((await names()).length).toBe(2));
    cutOff.value = false;
    const [temp] = (await names()).filter((name) => name !== "f.json");
    await utimes(path.join(root, temp!), old, old);

    expect(await sweepWriteLeftovers(root, () => now)).toEqual([path.join(root, temp!)]);
    expect(await readFile(path.join(root, "f.json"), "utf8")).toBe("{}");
  });
});

describe("SerialQueue", () => {
  /** A job that ends when `release()` is called. */
  function gate() {
    let release!: () => void;
    const open = new Promise<void>((resolve) => (release = resolve));
    return { open, release };
  }

  it("runs jobs one at a time, in the order asked", async () => {
    const queue = new SerialQueue();
    const log: string[] = [];
    const first = gate();
    const a = queue.run(async () => {
      log.push("a start");
      await first.open;
      log.push("a end");
      return "a";
    });
    const b = queue.run(async () => {
      log.push("b");
      return "b";
    });
    await Promise.resolve();
    expect(log).toEqual(["a start"]);
    first.release();
    expect(await Promise.all([a, b])).toEqual(["a", "b"]);
    expect(log).toEqual(["a start", "a end", "b"]);
  });

  it("gives a failed job's rejection to its caller and still runs the next one", async () => {
    const queue = new SerialQueue({ settleAtQuit: true });
    const failed = queue.run(async () => {
      throw new Error("disk full");
    });
    const after = queue.run(async () => "ok");
    await expect(failed).rejects.toThrow("disk full");
    await expect(after).resolves.toBe("ok");
    await expect(settleSerial()).resolves.toBeUndefined();
  });

  it("settleSerial waits for the jobs of settleAtQuit queues, queued behind each other, and not for other queues", async () => {
    const tracked = new SerialQueue({ settleAtQuit: true });
    const plain = new SerialQueue();
    const held = gate();
    const never = new Promise<void>(() => undefined);
    void plain.run(() => never);
    let done = 0;
    void tracked.run(async () => {
      await held.open;
      done++;
    });
    void tracked.run(async () => {
      done++;
    });
    let settled = false;
    const waiting = settleSerial().then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    held.release();
    await waiting;
    expect(done).toBe(2);
  });

  it("settleSerial waits for jobs a settled job asked for meanwhile", async () => {
    const tracked = new SerialQueue({ settleAtQuit: true });
    let late = false;
    void tracked.run(async () => {
      void tracked.run(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        late = true;
      });
    });
    await settleSerial();
    expect(late).toBe(true);
  });
});
