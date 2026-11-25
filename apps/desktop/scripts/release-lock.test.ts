import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript module shared with scripts/release.mjs
import { holdLock, lockHolder, lockPath, lockReport, lockStatus, mainCheckoutOf, stopOnSignals, takeLock } from "./release-lock.mjs";

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

  it("finds the releases folder from the main checkout, also when run from a worktree far away", () => {
    const { root, main } = home();
    const farAway = path.join(mkdtempSync(path.join(tmpdir(), "release-lock-far-")), "x", "y", "z", "wt");
    mkdirSync(farAway, { recursive: true });
    expect(lockPath(farAway, {})).toBeNull();
    expect(lockPath(farAway, {}, main)).toBe(path.join(root, "releases", "RELEASE-RUNNING"));
  });

  it("reads the main checkout as the first path git lists", () => {
    expect(mainCheckoutOf("worktree D:/Github/Tavora/tavora\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/wt/one\nHEAD def\n")).toBe("D:/Github/Tavora/tavora");
    expect(mainCheckoutOf("worktree /home/a b/repo\r\nHEAD x\r\n")).toBe("/home/a b/repo");
    expect(mainCheckoutOf("")).toBeNull();
  });

  it("says why it can't take the lock when the folder is missing, instead of throwing", () => {
    const { root } = home();
    expect(takeLock(path.join(root, "nope", "RELEASE-RUNNING"), "1.0.0").problem).toMatch(/Can't take the release lock/);
  });

  it("follows TAVORA_RELEASE_LOCK, and is null without a releases folder", () => {
    const { main } = home();
    expect(lockPath(main, { TAVORA_RELEASE_LOCK: "elsewhere/LOCK" })).toBe(path.resolve("elsewhere/LOCK"));
    const bare = path.join(mkdtempSync(path.join(tmpdir(), "release-lock-bare-")), "a", "b", "c", "repo");
    mkdirSync(bare, { recursive: true });
    expect(lockPath(bare, {})).toBeNull();
  });

  it("writes the version, the start time and who holds it on one line, and removes only its own file", () => {
    const { root } = home();
    const file = path.join(root, "releases", "RELEASE-RUNNING");
    const lock = takeLock(file, "0.23.13", new Date("2026-10-31T14:00:00Z"), { pid: 4242, host: "brain-pc" });
    expect(readFileSync(file, "utf8")).toBe("0.23.13 2026-10-31T14:00:00.000Z pid 4242@brain-pc\n");
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

  it("takes over a lock whose holder on this PC is gone, and only that one", () => {
    const { root } = home();
    const file = path.join(root, "releases", "RELEASE-RUNNING");
    const here = { pid: 7, host: "brain-pc", isRunning: (pid: number) => pid === 7 };

    writeFileSync(file, "0.23.12 2026-10-31T13:00:00.000Z pid 99@brain-pc\n");
    const taken = takeLock(file, "0.23.13", new Date("2026-10-31T14:00:00Z"), here);
    expect(taken.problem).toBeUndefined();
    expect(taken.replaced).toBe("0.23.12 2026-10-31T13:00:00.000Z pid 99@brain-pc");
    expect(readFileSync(file, "utf8")).toBe("0.23.13 2026-10-31T14:00:00.000Z pid 7@brain-pc\n");
    taken.release();

    // Still running, on another PC, or written before the lock named its holder: nobody can tell it is gone.
    for (const held of ["0.23.12 2026-10-31T13:00:00.000Z pid 7@brain-pc", "0.23.12 2026-10-31T13:00:00.000Z pid 99@macbook", "0.25.3 refresh 2026-10-31T13:00:00.000Z"]) {
      writeFileSync(file, `${held}\n`);
      expect(takeLock(file, "0.23.13", new Date(), here).problem).toMatch(/Another release is running/);
      expect(readFileSync(file, "utf8")).toBe(`${held}\n`);
    }
  });

  it("reads the holder of a refresh's lock too, whose label has two words", () => {
    expect(lockHolder("0.25.3 refresh 2026-10-31T13:00:00.000Z pid 12@brain-pc")).toEqual({ pid: 12, host: "brain-pc" });
    expect(lockHolder("0.25.3 2026-10-31T13:00:00.000Z")).toBeNull();
  });
});

describe("stopOnSignals", () => {
  it("stops and exits for Ctrl+C, a closed window, a kill and Ctrl+Break, with the signal's exit code", () => {
    const handlers = new Map<string, () => void>();
    const stopped: string[] = [];
    const exits: number[] = [];
    stopOnSignals((signal: string) => stopped.push(signal), (event: string, run: () => void) => void handlers.set(event, run), (code: number) => void exits.push(code));
    expect([...handlers.keys()].sort()).toEqual(["SIGBREAK", "SIGHUP", "SIGINT", "SIGTERM"]);
    handlers.get("SIGHUP")!();
    handlers.get("SIGTERM")!();
    expect(stopped).toEqual(["SIGHUP", "SIGTERM"]);
    expect(exits).toEqual([129, 143]);
  });

  it.skipIf(process.platform === "win32")("frees the lock when the release is killed or its window closes", async () => {
    const { spawn } = await import("node:child_process");
    const dir = mkdtempSync(path.join(tmpdir(), "release-lock-signal-"));
    const file = path.join(dir, "RELEASE-RUNNING");
    const script = path.join(dir, "hold.mjs");
    const lockModule = new URL("./release-lock.mjs", import.meta.url).href;
    writeFileSync(
      script,
      `import { holdLock, stopOnSignals } from ${JSON.stringify(lockModule)};\n` +
        `stopOnSignals(() => {});\n` +
        `const lock = holdLock(process.cwd(), "9.9.9", "", { TAVORA_RELEASE_LOCK: ${JSON.stringify(file)} });\n` +
        `console.log(lock.file ? "held" : lock.problem);\nsetInterval(() => {}, 1000);\n`,
    );
    for (const signal of ["SIGHUP", "SIGTERM"] as const) {
      const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "inherit"] });
      await new Promise<void>((resolve, reject) => {
        child.stdout.on("data", (chunk) => String(chunk).includes("held") && resolve());
        child.on("exit", () => reject(new Error("the holder quit before it held the lock")));
      });
      expect(existsSync(file)).toBe(true);
      const code = await new Promise<number | null>((resolve) => {
        child.on("exit", (exitCode) => resolve(exitCode));
        child.kill(signal);
      });
      expect(code).toBe(signal === "SIGHUP" ? 129 : 143);
      expect(existsSync(file)).toBe(false);
    }
  }, 30_000);
});

describe("holdLock", () => {
  it("takes the lock, refuses a second, and its exit handler (also run after Ctrl+C's exit) removes the file", () => {

    const file = path.join(mkdtempSync(path.join(tmpdir(), "release-lock-hold-")), "RELEASE-RUNNING");
    const handlers: (() => void)[] = [];
    const on = (_event: string, run: () => void) => void handlers.push(run);
    const env = { TAVORA_RELEASE_LOCK: file };
    expect(holdLock("C:/repo", "0.25.3 refresh", "", env, on)).toEqual({ file });
    expect(readFileSync(file, "utf8")).toMatch(/^0\.25\.3 refresh /);
    expect(holdLock("C:/repo", "0.25.3", "", env, on)).toMatchObject({ problem: expect.stringContaining("Another release is running") });
    expect(handlers).toHaveLength(1);
    handlers[0]!();
    expect(existsSync(file)).toBe(false);
  });

  it("tells a session about to merge whether a release really runs, or only left its lock behind (hunt 2026-11-25 E9)", () => {
    const { root } = home();
    const file = path.join(root, "releases", "RELEASE-RUNNING");
    const who = (running: number[]) => ({ host: "brain-pc", isRunning: (pid: number) => running.includes(pid) });
    expect(lockStatus(file, who([]))).toEqual({ state: "free" });
    writeFileSync(file, "0.25.4 2026-11-24T10:00:00.000Z pid 4242@brain-pc\n");
    expect(lockStatus(file, who([4242]))).toEqual({ state: "running", line: "0.25.4 2026-11-24T10:00:00.000Z pid 4242@brain-pc" });
    // Killed without its exit handler: the process is gone, nothing releases.
    expect(lockStatus(file, who([]))).toMatchObject({ state: "stale" });
    // Another PC's, or one that names no holder, can't be checked from here: wait.
    expect(lockStatus(file, { host: "other-pc", isRunning: () => false })).toMatchObject({ state: "running" });
    writeFileSync(file, "0.25.4 2026-11-24T10:00:00.000Z\n");
    expect(lockStatus(file, who([]))).toMatchObject({ state: "running" });
  });

  it("says unknown and exits 1 when it can't look, so a merge waits (review of #976)", () => {
    const { root } = home();
    const file = path.join(root, "releases", "RELEASE-RUNNING");
    expect(lockReport(file, false)).toMatchObject({ code: 1, text: expect.stringMatching(/^unknown/) });
    expect(lockReport(null, true)).toMatchObject({ code: 1, text: expect.stringMatching(/^unknown/) });
    expect(lockReport(file, true)).toEqual({ text: "free", code: 0 });
    writeFileSync(file, "0.25.4 2026-11-24T10:00:00.000Z pid 4242@brain-pc\n");
    expect(lockReport(file, true, { host: "brain-pc", isRunning: () => true })).toMatchObject({ code: 1, text: expect.stringMatching(/^running/) });
    expect(lockReport(file, true, { host: "brain-pc", isRunning: () => false })).toMatchObject({ code: 0, text: expect.stringMatching(/^stale/) });
  });
});
