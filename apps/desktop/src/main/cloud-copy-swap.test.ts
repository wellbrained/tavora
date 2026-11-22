import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lookSwapStatus, stepSwap, SWAP_IDLE, writeSwapStatus, type SwapEvent, type SwapPlan, type SwapStatus } from "./cloud-copy-swap";
import { HeldError, isDamaged, look, lookJson, lookNames, lookStat, unlessHeld } from "./file-look";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-swap-status-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const plan: SwapPlan = { keepIn: path.join(path.sep, "data", "backups", "cloud-copy-1-this-pc"), moduleFiles: path.join(path.sep, "pictures"), own: { steamProfile: "me" }, empty: [] };
const idle = SWAP_IDLE;
const chosen: SwapStatus = { phase: "chosen" };
const swapping: SwapStatus = { phase: "swapping", plan };
const undoing: SwapStatus = { phase: "undoing", plan };
const lost: SwapStatus = { phase: "asking", why: "lost", files: ["library.json"] };
const wentBack: SwapStatus = { phase: "asking", why: "went-back", files: [] };
const held: SwapStatus = { phase: "held" };

describe("stepSwap", () => {
  const steps: [SwapStatus, SwapEvent, SwapStatus][] = [
    [idle, { type: "chosen" }, chosen],
    [lost, { type: "chosen" }, chosen],
    [swapping, { type: "chosen" }, swapping],
    [idle, { type: "begin", plan }, swapping],
    [chosen, { type: "begin", plan }, swapping],
    [undoing, { type: "begin", plan }, undoing],
    [wentBack, { type: "begin", plan }, wentBack],
    [swapping, { type: "finished" }, idle],
    [undoing, { type: "finished" }, undoing],
    [swapping, { type: "go-back" }, undoing],
    [undoing, { type: "try-again" }, swapping],
    [chosen, { type: "go-back" }, chosen],
    [undoing, { type: "went-back", copyOn: true }, wentBack],
    [undoing, { type: "went-back", copyOn: false }, idle],
    [swapping, { type: "went-back", copyOn: true }, swapping],
    [idle, { type: "lost", files: ["library.json"] }, lost],
    [wentBack, { type: "lost", files: ["library.json"] }, lost],
    [lost, { type: "lost", files: ["profile.json"] }, { phase: "asking", why: "lost", files: ["library.json", "profile.json"] }],
    [swapping, { type: "lost", files: ["library.json"] }, swapping],
    [chosen, { type: "copy-gone" }, wentBack],
    [idle, { type: "copy-gone" }, idle],
    [lost, { type: "answered" }, idle],
    [chosen, { type: "answered" }, idle],
    [swapping, { type: "answered" }, swapping],
    [swapping, { type: "forgotten" }, undoing],
    [undoing, { type: "forgotten" }, undoing],
    [chosen, { type: "forgotten" }, idle],
    [lost, { type: "forgotten" }, idle],
    [held, { type: "forgotten" }, held],
    [held, { type: "begin", plan }, held],
  ];
  it.each(steps)("%j on %j is %j", (from, event, to) => {
    expect(stepSwap(from, event)).toEqual(to);
  });
});

describe("the status on disk", () => {
  const file = () => path.join(dir, "cloud-copy-status.json");
  const backups = path.dirname(plan.keepIn);

  it.each([chosen, swapping, undoing, lost, wentBack])("reads back %j", async (status) => {
    await writeSwapStatus(file(), status);
    expect(await lookSwapStatus(file(), backups)).toEqual({ status: "present", value: status });
  });

  it("is no file while idle", async () => {
    await writeSwapStatus(file(), chosen);
    await writeSwapStatus(file(), idle);
    expect(await lookStat(file())).toEqual({ status: "missing" });
    expect(await lookSwapStatus(file(), backups)).toEqual({ status: "present", value: idle });
  });

  it("never writes held", async () => {
    await expect(writeSwapStatus(file(), held)).rejects.toThrow();
  });

  it.each(["", "{", "[]", '{"v":1,"phase":"nonsense"}', '{"v":2,"phase":"chosen"}', '{"v":1,"phase":"swapping","plan":{"keepIn":"/elsewhere/x","moduleFiles":"/p","own":null,"empty":[]}}'])("holds on %s", async (text) => {
    await writeFile(file(), text);
    const looked = await lookSwapStatus(file(), backups);
    expect(looked.status).toBe("held");
    expect(isDamaged(looked)).toBe(true);
  });
});

describe("a read has three answers", () => {
  it("only ENOENT is missing", async () => {
    expect((await look(() => Promise.reject(Object.assign(new Error("x"), { code: "ENOENT" })))).status).toBe("missing");
    for (const code of ["EBUSY", "EPERM", "EACCES", "EIO", "ENOTDIR", "EMFILE", undefined]) {
      expect((await look(() => Promise.reject(Object.assign(new Error("x"), { code })))).status).toBe("held");
    }
  });

  it("damaged JSON is held, a file that isn't an object too", async () => {
    for (const text of ["", "{", "[]", "3", "null"]) {
      await writeFile(path.join(dir, "a.json"), text);
      expect(isDamaged(await lookJson(path.join(dir, "a.json")))).toBe(true);
    }
    await writeFile(path.join(dir, "a.json"), '{"a":1}');
    expect(await lookJson(path.join(dir, "a.json"))).toEqual({ status: "present", value: { a: 1 } });
    expect(await lookJson(path.join(dir, "none.json"))).toEqual({ status: "missing" });
  });

  it("a folder read as a file is held, not missing", async () => {
    await mkdir(path.join(dir, "folder"));
    expect((await lookJson(path.join(dir, "folder"))).status).toBe("held");
    expect((await lookNames(path.join(dir, "none"))).status).toBe("missing");
  });

  it("unlessHeld gives the value, null, or stops the work", () => {
    expect(unlessHeld({ status: "present", value: 1 })).toBe(1);
    expect(unlessHeld({ status: "missing" })).toBeNull();
    expect(() => unlessHeld({ status: "held", error: Object.assign(new Error("x"), { code: "EBUSY" }) })).toThrow(HeldError);
  });
});
