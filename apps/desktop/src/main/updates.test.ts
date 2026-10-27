import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { UpdateState } from "../shared/host-api";
import { CHECK_EVERY_MS, FIRST_CHECK_MS, UPDATER_HEADER, UpdateManager, type Timers, type UpdaterLike } from "./updates";

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  requestHeaders: Record<string, string> | null = null;
  checks = 0;
  downloads = 0;
  installs: [boolean | undefined, boolean | undefined][] = [];
  failCheck = false;
  failDownload = false;
  async checkForUpdates() {
    this.checks += 1;
    if (this.failCheck) throw new Error("offline");
  }
  async downloadUpdate() {
    this.downloads += 1;
    if (this.failDownload) throw new Error("connection lost");
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
  const manager = new UpdateManager({
    updater: updater as unknown as UpdaterLike,
    autoDownload,
    onChange: (s) => states.push(s),
    ...(onDownloaded ? { onDownloaded } : {}),
    log: (l) => logs.push(l),
    timers,
    now: () => new Date("2026-10-16T09:30:00.000Z"),
  });
  return { updater, manager, states, logs, pending };
}

describe("UpdateManager", () => {
  it("sets the updater up: automatic download as chosen, install on quit always", () => {
    const on = make(true);
    expect(on.updater.autoDownload).toBe(true);
    expect(on.updater.autoInstallOnAppQuit).toBe(true);
    expect(make(false).updater.autoDownload).toBe(false);
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

  it("checks once shortly after start and then every six hours", async () => {
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
    expect(manager.state).toEqual({ status: "downloading", version: "0.3.0" });
    updater.emit("update-downloaded", { version: "0.3.0" });
    expect(manager.state).toEqual({ status: "ready", version: "0.3.0" });
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
    expect(manager.state).toEqual({ status: "available", version: "0.3.0" });
    expect(updater.downloads).toBe(0);
    await manager.download();
    expect(updater.downloads).toBe(1);
    expect(manager.state).toEqual({ status: "downloading", version: "0.3.0" });
  });

  it("turning automatic download on starts a version that was waiting", async () => {
    const { manager, updater } = make(false);
    updater.emit("update-available", { version: "0.3.0" });
    manager.setAutoDownload(true);
    await Promise.resolve();
    expect(updater.autoDownload).toBe(true);
    expect(updater.downloads).toBe(1);
  });

  it("ignores errors: offline checks are logged, a failed download goes back to idle for the next check", async () => {
    const { manager, updater, logs } = make();
    updater.failCheck = true;
    await manager.check();
    expect(manager.state).toMatchObject({ status: "idle" });
    expect(logs.some((l) => l.includes("offline"))).toBe(true);

    updater.emit("update-available", { version: "0.3.0" });
    updater.emit("error", new Error("connection lost"));
    expect(manager.state).toMatchObject({ status: "idle" });
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

  it("goes back to idle when a manual download fails", async () => {
    const { manager, updater } = make(false);
    updater.emit("update-available", { version: "0.3.0" });
    updater.failDownload = true;
    await manager.download();
    expect(manager.state).toMatchObject({ status: "idle" });
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