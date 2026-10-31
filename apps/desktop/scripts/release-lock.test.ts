import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript module shared with scripts/release.mjs
import { lockPath, takeLock } from "./release-lock.mjs";

/** A folder like D:\Github\Tavora: a main checkout, a worktrees folder with a clone, and releases. */
function home(): { root: string; main: string; clone: string } {
  const root = mkdtempSync(path.join(tmpdir(), "release-lock-"));
  const main = path.join(root, "tavora");
  const clone = path.join(root, "worktrees", "release-main");
  for (const dir of [main, clone, path.join(root, "releases")]) mkdirSync(dir, { recursive: true });
  return { root, main, clone };
}

describe("release lock", () => {
  it("lives in the releases folder next to the main checkout, also for a clone under worktrees", () => {
    const { root, main, clone } = home();
    const expected = path.join(root, "releases", "RELEASE-RUNNING");
    expect(lockPath(main, {})).toBe(expected);
    expect(lockPath(clone, {})).toBe(expected);
  });

  it("follows TAVORA_RELEASE_LOCK, and is null without a releases folder", () => {
    const { main } = home();
    expect(lockPath(main, { TAVORA_RELEASE_LOCK: "elsewhere/LOCK" })).toBe(path.resolve("elsewhere/LOCK"));
    const bare = path.join(mkdtempSync(path.join(tmpdir(), "release-lock-bare-")), "a", "b", "c", "repo");
    mkdirSync(bare, { recursive: true });
    expect(lockPath(bare, {})).toBeNull();
  });

  it("writes the version and start time, and removes only its own file", () => {
    const { root } = home();
    const file = path.join(root, "releases", "RELEASE-RUNNING");
    const lock = takeLock(file, "0.23.13", new Date("2026-10-31T14:00:00Z"));
    expect(readFileSync(file, "utf8")).toBe("0.23.13 2026-10-31T14:00:00.000Z\n");
    lock.release();
    expect(existsSync(file)).toBe(false);

    const replaced = takeLock(file, "0.23.13");
    writeFileSync(file, "0.23.14 someone else\n");
    replaced.release();
    expect(readFileSync(file, "utf8")).toBe("0.23.14 someone else\n");
  });

  it("refuses while another release holds it", () => {
    const { root } = home();
    const file = path.join(root, "releases", "RELEASE-RUNNING");
    writeFileSync(file, "0.23.12 2026-10-31T13:00:00.000Z\n");
    const lock = takeLock(file, "0.23.13");
    expect(lock.problem).toMatch(/Another release is running .*0\.23\.12 2026-10-31T13:00:00\.000Z.*delete that file/);
    expect(readFileSync(file, "utf8")).toBe("0.23.12 2026-10-31T13:00:00.000Z\n");
  });
});
