import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { removeRefusedInstaller } from "./refused-update";

const file = path.join("cache", "pending", "Tavora-Setup-0.3.0.exe");

function run(info: { downloadedFile?: unknown }, packaged: boolean) {
  const removed: string[] = [];
  const remove = vi.fn(async (target: string) => void removed.push(target));
  removeRefusedInstaller(info, packaged, remove as never);
  return removed;
}

describe("removeRefusedInstaller", () => {
  it("deletes the refused installer and both blockmaps", () => {
    expect(run({ downloadedFile: file }, true)).toEqual([file, path.join("cache", "pending", "current.blockmap"), path.join("cache", "current.blockmap")]);
  });

  it("passes force, and a failing delete is swallowed", async () => {
    const remove = vi.fn(async () => {
      throw new Error("EBUSY");
    });
    expect(() => removeRefusedInstaller({ downloadedFile: file }, true, remove as never)).not.toThrow();
    expect(remove).toHaveBeenCalledWith(file, { force: true });
    await Promise.resolve();
  });

  it("leaves files alone in an unpackaged run or without a file path", () => {
    expect(run({ downloadedFile: file }, false)).toEqual([]);
    expect(run({}, true)).toEqual([]);
    expect(run({ downloadedFile: 5 }, true)).toEqual([]);
  });
});
