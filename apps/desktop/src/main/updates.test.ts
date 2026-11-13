import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { UpdateState } from "../shared/host-api";
import { CHECK_EVERY_MS, FIRST_CHECK_MS, LOG_REPEAT_MS, RETRY_EVERY_MS, PreviewUpdater, PROGRESS_EVERY_MS, readReleaseNotes, UPDATER_HEADER, UpdateManager, type Timers, type UpdaterLike } from "./updates";

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  requestHeaders: Record<string, string> | null = null;
  checks = 0;
  downloads = 0;
  installs: [boolean | undefined, boolean | undefined][] = [];
  failCheck = false;
  failDownload = false;
  /** The version the feed offers; a check without one answers without any event. */
  found: string | null = null;
  async checkForUpdates() {
    this.checks += 1;
    // Like electron-updater: an "error" event first, then the call rejects.
    if (this.failCheck) {
      this.emit("error", new Error("offline"));
      throw new Error("offline");
    }
    if (!this.found) return;
    this.emit("update-available", { version: this.found });
    // Like electron-updater: with its own autoDownload on, the check starts the download itself.
    if (this.autoDownload) void this.downloadUpdate().catch(() => undefined);
  }
  async downloadUpdate() {
    this.downloads += 1;
    if (this.failDownload) {
      this.emit("error", new Error("connection lost"));
      throw new Error("connection lost");
    }
  }
  quitAndInstall(silent?: boolean, run?: boolean) {
    this.installs.push([silent, run]);
  }
}

/** Timers the test runs by hand. */
function fakeTimers() {
  const pending: { id: number; run: () => void; ms: number; repeat: boolean }[] = [];
  let next = 1;
  const timers: Timers = {
    setTimeout: (run, ms) => (pending.push({ id: next, run, ms, repeat: false }), next++),
    clearTimeout: (id) => void pending.splice(0, pending.length, ...pending.filter((t) => t.id !== id)),
    setInterval: (run, ms) => (pending.push({ id: next, run, ms, repeat: true }), next++),
    clearInterval: (id) => void pending.splice(0, pending.length, ...pending.filter((t) => t.id !== id)),
  };
  return { timers, pending };
}

function make(autoDownload = true, onDownloaded?: (version: string) => void) {
  const updater = new FakeUpdater();
  const states: UpdateState[] = [];
  const logs: string[] = [];
  const { timers, pending } = fakeTimers();
  const clock = { ms: Date.parse("2026-10-16T09:30:00.000Z") };
  const manager = new UpdateManager({
    updater: updater as unknown as UpdaterLike,
    autoDownload,
    onChange: (s) => states.push(s),
    ...(onDownloaded ? { onDownloaded } : {}),
    log: (l) => logs.push(l),
    timers,
    now: () => new Date(clock.ms),
  });
  return { updater, manager, states, logs, pending, clock };
}

describe("UpdateManager", () => {
  it("sets the updater up: it never downloads by itself (the manager starts downloads), install on quit always", () => {
    const on = make(true);
    expect(on.updater.autoDownload).toBe(false);
    expect(on.updater.autoInstallOnAppQuit).toBe(true);
    expect(make(false).updater.autoDownload).toBe(false);
  });

  it("with automatic download on, a check that finds a version downloads it once", async () => {
    const { manager, updater } = make(true);
    updater.found = "0.3.0";
    await manager.check();
    await Promise.resolve();
    expect(updater.downloads).toBe(1);
    expect(manager.state).toMatchObject({ status: "downloading", version: "0.3.0" });
  });

  it("marks the updater's requests, so the feed can tell them from an installer download", () => {
    expect(make().updater.requestHeaders).toEqual({ [UPDATER_HEADER]: "1" });
  });

  it("tells the host once when a version finished downloading, with its number", () => {
    const seen: string[] = [];
    const { updater } = make(true, (version) => seen.push(version));
    updater.emit("update-available", { version: "0.3.0" });
    expect(seen).toEqual([]);
    updater.emit("update-downloaded", { version: "0.3.0" });
    expect(seen).toEqual(["0.3.0"]);
  });

  it("checks once right at start and then every 5 minutes", async () => {
    const { manager, pending, updater } = make();
    manager.start();
    expect(pending.map((t) => [t.ms, t.repeat])).toEqual([
      [FIRST_CHECK_MS, false],
      [CHECK_EVERY_MS, true],
    ]);
    pending[0]!.run();
    await new Promise((resolve) => setTimeout(resolve, 0)); // the first check finishes
    pending[1]!.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updater.checks).toBe(2);
    manager.stop();
    expect(pending).toHaveLength(0);
  });

  it("goes found -> downloading -> ready, and restarts into the new version", () => {
    const { manager, updater, states } = make();
    updater.emit("update-available", { version: "0.3.0" });
    expect(manager.state).toEqual({ status: "downloading", version: "0.3.0", notes: [], percent: 0 });
    updater.emit("update-downloaded", { version: "0.3.0" });
    expect(manager.state).toEqual({ status: "ready", version: "0.3.0", notes: [] });
    manager.restartNow();
    expect(updater.installs).toEqual([[true, true]]);
    expect(states.map((s) => s.status)).toEqual(["downloading", "ready"]);
  });

  it("does not restart before the download is done", () => {
    const { manager, updater } = make();
    manager.restartNow();
    updater.emit("update-available", { version: "0.3.0" });
    manager.restartNow();
    expect(updater.installs).toEqual([]);
  });

  it("with automatic download off waits for the user, then downloads on request", async () => {
    const { manager, updater } = make(false);
    updater.emit("update-available", { version: "0.3.0" });
    expect(manager.state).toEqual({ status: "available", version: "0.3.0", notes: [], failed: false });
    expect(updater.downloads).toBe(0);
    await manager.download();
    expect(updater.downloads).toBe(1);
    expect(manager.state).toEqual({ status: "downloading", version: "0.3.0", notes: [], percent: 0 });
  });

  it("turning automatic download on starts a version that was waiting", async () => {
    const { manager, updater } = make(false);
    updater.emit("update-available", { version: "0.3.0" });
    manager.setAutoDownload(true);
    await Promise.resolve();
    expect(updater.autoDownload).toBe(false);
    expect(updater.downloads).toBe(1);
    expect(manager.state).toMatchObject({ status: "downloading", version: "0.3.0" });
  });

  it("logs errors: an offline check goes back to idle, a failed download keeps the version to try again", async () => {
    const { manager, updater, logs } = make();
    updater.failCheck = true;
    await manager.check();
    expect(manager.state).toMatchObject({ status: "idle" });
    expect(logs.some((l) => l.includes("offline"))).toBe(true);

    updater.failDownload = true;
    updater.emit("update-available", { version: "0.3.0", releaseNotes: "- One" });
    await Promise.resolve();
    expect(manager.state).toEqual({ status: "available", version: "0.3.0", notes: ["One"], failed: true });
  });

  it("writes one line for a failed download, though the updater both sends an error and rejects", async () => {
    const off = make(false);
    off.updater.emit("update-available", { version: "0.3.0" });
    off.updater.failDownload = true;
    await off.manager.download();
    expect(off.logs).toEqual(["update 0.3.0 available", "update error: connection lost"]);

    const on = make(true);
    on.updater.failDownload = true;
    on.updater.found = "0.3.0";
    await on.manager.check();
    await Promise.resolve();
    expect(on.logs).toEqual(["update 0.3.0 available", "update error: connection lost"]);
  });

  it("a check that fails while the user's download runs leaves the download alone", async () => {
    const { manager, updater, states } = make(false);
    updater.emit("update-available", { version: "0.3.0" });
    let failCheck!: () => void;
    updater.checkForUpdates = () =>
      new Promise<void>((_, reject) => {
        failCheck = () => {
          updater.emit("error", new Error("500 on latest.yml"));
          reject(new Error("500 on latest.yml"));
        };
      });
    const check = manager.check();
    let finish!: () => void;
    updater.downloadUpdate = () => new Promise<void>((resolve) => (finish = resolve));
    const download = manager.download();
    failCheck();
    await check;
    expect(manager.state).toMatchObject({ status: "downloading", version: "0.3.0" });
    expect(states.some((s) => s.status === "available" && s.failed)).toBe(false);
    updater.emit("update-downloaded", { version: "0.3.0" });
    finish();
    await download;
    expect(manager.state).toMatchObject({ status: "ready", version: "0.3.0" });
  });

  it("logs a line only when it differs from the last one, so checks every few minutes don't fill the log", () => {
    const { updater, logs } = make(false);
    updater.emit("update-not-available");
    updater.emit("update-not-available");
    updater.emit("update-available", { version: "0.3.0" });
    updater.emit("update-available", { version: "0.3.0" });
    updater.emit("update-not-available");
    expect(logs).toEqual(["up to date", "update 0.3.0 available", "up to date"]);
  });

  it("writes one line per failed check, and repeats a line once an hour so the log shows checks still run", async () => {
    const { manager, updater, logs, clock } = make(false);
    updater.failCheck = true;
    await manager.check();
    await manager.check();
    expect(logs).toEqual(["update error: offline"]);
    clock.ms += LOG_REPEAT_MS;
    await manager.check();
    expect(logs).toEqual(["update error: offline", "update error: offline"]);
  });

  it("a check that answers during the user's download leaves the download alone", async () => {
    const { manager, updater } = make(false);
    updater.emit("update-available", { version: "0.3.0" });
    void manager.download();
    expect(manager.state).toMatchObject({ status: "downloading", version: "0.3.0" });
    updater.emit("update-available", { version: "0.3.0" });
    expect(manager.state).toMatchObject({ status: "downloading", version: "0.3.0" });
  });

  it("keeps a failed download marked as failed through later checks, until a newer version comes", async () => {
    const { manager, updater } = make(false);
    updater.emit("update-available", { version: "0.3.0" });
    updater.failDownload = true;
    await manager.download();
    expect(manager.state).toMatchObject({ status: "available", version: "0.3.0", failed: true });
    updater.emit("update-available", { version: "0.3.0" });
    expect(manager.state).toMatchObject({ status: "available", version: "0.3.0", failed: true });
    updater.emit("update-available", { version: "0.3.1" });
    expect(manager.state).toMatchObject({ status: "available", version: "0.3.1", failed: false });
  });

  it("with automatic download on, starts a failed download over at most once an hour, still checking every time", async () => {
    const { manager, updater, clock } = make(true);
    updater.found = "0.3.0";
    updater.failDownload = true;
    await manager.check();
    await Promise.resolve();
    expect(manager.state).toMatchObject({ status: "available", version: "0.3.0", failed: true });
    expect(updater.downloads).toBe(1);
    updater.failDownload = false;
    clock.ms += CHECK_EVERY_MS;
    await manager.check();
    expect(updater.checks).toBe(2);
    expect(updater.downloads).toBe(1);
    expect(manager.state).toMatchObject({ status: "available", version: "0.3.0", failed: true });
    clock.ms += RETRY_EVERY_MS;
    await manager.check();
    expect(updater.downloads).toBe(2);
    expect(manager.state).toMatchObject({ status: "downloading", version: "0.3.0" });
  });

  it("with automatic download on, downloads a newer version right away after a failed download", async () => {
    const { manager, updater, clock } = make(true);
    updater.found = "0.3.0";
    updater.failDownload = true;
    await manager.check();
    await Promise.resolve();
    expect(manager.state).toMatchObject({ status: "available", version: "0.3.0", failed: true });
    updater.failDownload = false;
    updater.found = "0.3.1";
    clock.ms += CHECK_EVERY_MS;
    await manager.check();
    expect(updater.downloads).toBe(2);
    expect(manager.state).toMatchObject({ status: "downloading", version: "0.3.1" });
  });

  it("starts a failed download over when the clock was set back", async () => {
    const { manager, updater, clock } = make(true);
    updater.found = "0.3.0";
    updater.failDownload = true;
    await manager.check();
    await Promise.resolve();
    updater.failDownload = false;
    clock.ms -= 24 * 60 * 60 * 1000;
    await manager.check();
    expect(updater.downloads).toBe(2);
  });

  it("asks again about a version whose download failed, so a check after the wait starts it over", async () => {
    const { manager, updater, clock } = make();
    updater.failDownload = true;
    updater.emit("update-available", { version: "0.3.0" });
    await Promise.resolve();
    updater.failDownload = false;
    clock.ms += RETRY_EVERY_MS;
    updater.checkForUpdates = async () => {
      updater.checks += 1;
      // Never shows checking in between: the marker stays.
      expect(manager.state).toMatchObject({ status: "available" });
      updater.emit("update-available", { version: "0.3.0" });
    };
    await manager.check();
    expect(updater.checks).toBe(1);
    expect(manager.state).toMatchObject({ status: "downloading", version: "0.3.0" });
  });

  it("carries the release's notes, and keeps them when the download event has none", () => {
    const { manager, updater } = make();
    updater.emit("update-available", { version: "0.3.0", releaseNotes: "- Faster start\n- Fixed the eraser\n" });
    expect(manager.state).toMatchObject({ notes: ["Faster start", "Fixed the eraser"] });
    updater.emit("update-downloaded", { version: "0.3.0" });
    expect(manager.state).toEqual({ status: "ready", version: "0.3.0", notes: ["Faster start", "Fixed the eraser"] });
  });

  it("shows the download's progress in whole percent, at most a few times a second", () => {
    const { manager, updater, states, clock } = make();
    updater.emit("update-available", { version: "0.3.0" });
    clock.ms += PROGRESS_EVERY_MS;
    updater.emit("download-progress", { percent: 10.7 });
    expect(manager.state).toMatchObject({ percent: 10 });
    updater.emit("download-progress", { percent: 20 });
    expect(manager.state).toMatchObject({ percent: 10 });
    clock.ms += PROGRESS_EVERY_MS;
    updater.emit("download-progress", { percent: 30 });
    expect(manager.state).toMatchObject({ percent: 30 });
    clock.ms += PROGRESS_EVERY_MS;
    updater.emit("download-progress", { percent: 25 });
    expect(manager.state).toMatchObject({ percent: 30 });
    expect(states.filter((s) => s.status === "downloading")).toHaveLength(3);
  });

  it("does not check again while a version is downloading or ready", async () => {
    const { manager, updater } = make();
    await manager.check();
    updater.emit("update-available", { version: "0.3.0" });
    await manager.check();
    updater.emit("update-downloaded", { version: "0.3.0" });
    await manager.check();
    expect(updater.checks).toBe(1);
  });

  it("keeps the version, marked as failed, when a manual download fails, and can try again", async () => {
    const { manager, updater } = make(false);
    updater.emit("update-available", { version: "0.3.0" });
    updater.failDownload = true;
    await manager.download();
    expect(manager.state).toEqual({ status: "available", version: "0.3.0", notes: [], failed: true });
    updater.failDownload = false;
    await manager.download();
    expect(updater.downloads).toBe(2);
    expect(manager.state).toMatchObject({ status: "downloading" });
  });

  it("shows checking while it asks, then idle with the time of the check", async () => {
    const { manager, updater, states } = make();
    updater.checkForUpdates = async () => {
      expect(manager.state).toEqual({ status: "checking" });
      updater.emit("update-not-available");
    };
    await manager.check();
    expect(manager.state).toEqual({ status: "idle", checkedAt: "2026-10-16T09:30:00.000Z", failed: false });
    expect(states.map((s) => s.status)).toEqual(["checking", "idle"]);
  });

  it("ends a check that answered without any event, so it never hangs on checking", async () => {
    const { manager } = make();
    await manager.check();
    expect(manager.state).toEqual({ status: "idle", checkedAt: "2026-10-16T09:30:00.000Z", failed: false });
  });

  it("reports a failed check as idle with failed set, and tries again the next time", async () => {
    const { manager, updater } = make();
    updater.failCheck = true;
    await manager.check();
    expect(manager.state).toEqual({ status: "idle", checkedAt: "2026-10-16T09:30:00.000Z", failed: true });
    updater.failCheck = false;
    await manager.check();
    expect(manager.state).toMatchObject({ status: "idle", failed: false });
    expect(updater.checks).toBe(2);
  });

  it("does not start a second check while one is running", async () => {
    const { manager, updater } = make();
    let release!: () => void;
    updater.checkForUpdates = () => new Promise<void>((resolve) => ((updater.checks += 1), (release = resolve)));
    const first = manager.check();
    await manager.check();
    release();
    await first;
    expect(updater.checks).toBe(1);
  });
});

describe("readReleaseNotes", () => {
  it("reads a Markdown list, HTML and per-version notes as plain lines", () => {
    expect(readReleaseNotes("- One\n* Two\n\n3. Three\n")).toEqual(["One", "Two", "Three"]);
    expect(readReleaseNotes("<ul><li>One</li><li>Two</li></ul>")).toEqual(["One", "Two"]);
    expect(readReleaseNotes([{ version: "0.3.0", note: "- One" }, { version: "0.2.9", note: null }])).toEqual(["One"]);
    expect(readReleaseNotes("### In 0.3.0\n- One")).toEqual(["One"]);
    expect(readReleaseNotes(null)).toEqual([]);
  });
});

describe("PreviewUpdater", () => {
  it("finds the next patch version, downloads it step by step, and ends the preview on restart", async () => {
    const updater = new PreviewUpdater("0.23.99", { stepMs: 0 });
    const manager = new UpdateManager({ updater, autoDownload: false, onChange: () => {}, timers: fakeTimers().timers });
    await manager.check();
    expect(manager.state).toMatchObject({ status: "available", version: "0.23.100" });
    await manager.download();
    expect(manager.state).toMatchObject({ status: "ready", version: "0.23.100" });
    manager.restartNow();
    expect(manager.state).toMatchObject({ status: "idle" });
  });

  it("fails the download halfway when asked to, so the failed step can be seen", async () => {
    const updater = new PreviewUpdater("0.23.99", { stepMs: 0, fail: true });
    const manager = new UpdateManager({ updater, autoDownload: false, onChange: () => {}, timers: fakeTimers().timers });
    await manager.check();
    await manager.download();
    expect(manager.state).toMatchObject({ status: "available", failed: true });
  });
});
