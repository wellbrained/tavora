import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { UpdateState } from "../shared/host-api";
import { CHECK_EVERY_MS, FIRST_CHECK_MS, UpdateManager, type Timers, type UpdaterLike } from "./updates";

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
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

function make(autoDownload = true) {
  const updater = new FakeUpdater();
  const states: UpdateState[] = [];
  const logs: string[] = [];
  const { timers, pending } = fakeTimers();
  const manager = new UpdateManager({ updater: updater as unknown as UpdaterLike, autoDownload, onChange: (s) => states.push(s), log: (l) => logs.push(l), timers });
  return { updater, manager, states, logs, pending };
}

describe("UpdateManager", () => {
  it("sets the updater up: automatic download as chosen, install on quit always", () => {
    const on = make(true);
    expect(on.updater.autoDownload).toBe(true);
    expect(on.updater.autoInstallOnAppQuit).toBe(true);
    expect(make(false).updater.autoDownload).toBe(false);
  });

  it("checks once shortly after start and then every six hours", () => {
    const { manager, pending, updater } = make();
    manager.start();
    expect(pending.map((t) => [t.ms, t.repeat])).toEqual([
      [FIRST_CHECK_MS, false],
      [CHECK_EVERY_MS, true],
    ]);
    pending[0]!.run();
    pending[1]!.run();
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

  it("with automatic download off waits for the player, then downloads on request", async () => {
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
    expect(manager.state).toEqual({ status: "idle" });
    expect(logs.some((l) => l.includes("offline"))).toBe(true);

    updater.emit("update-available", { version: "0.3.0" });
    updater.emit("error", new Error("connection lost"));
    expect(manager.state).toEqual({ status: "idle" });
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
    expect(manager.state).toEqual({ status: "idle" });
  });
});
