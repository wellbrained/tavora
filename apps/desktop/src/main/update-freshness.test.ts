// The app's check of the feed's second signature (tavoraSignature2): what it says for each feed, what it keeps, and
// that this release only reports it.
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { UpdateState } from "../shared/host-api";
import {
  describeFreshness,
  ENFORCE_FEED_FRESHNESS,
  FEED_STATE_FILE,
  FeedFreshnessCheck,
  feedInstaller,
  feedPlatform,
  readNewestIssuedAt,
  unconfirmed,
} from "./update-freshness";
import { checkDownloadedUpdate, checkFeedFreshness, feedTime, makeUpdateKey, signUpdate, signUpdate2, type FeedStatement, type UpdateCheck } from "./update-signature";
import { UpdateManager, type UpdaterLike } from "./updates";

const release = makeUpdateKey();
const backup = makeUpdateKey();
const stranger = makeUpdateKey();
const pinned = { release: release.publicKey, backup: backup.publicKey };
const sha512 = createHash("sha512").update("installer").digest("base64");
const FILE = "Tavora-Setup-1.0.1.exe";
const UPDATE = { version: "1.0.1", file: FILE, sha512 };
const DAY = 86_400_000;
const ISSUED = Date.parse("2026-11-24T10:00:00Z");
const at = (ms: number) => new Date(ISSUED + ms);

function statement(over: Partial<FeedStatement> = {}): FeedStatement {
  return { channel: "stable", platform: "win-x64", issuedAt: feedTime(at(0)), expiresAt: feedTime(at(30 * DAY)), ...over };
}
const sign2 = (s = statement(), key = release.privateKey, update = UPDATE) => signUpdate2({ ...update, ...s }, key);
const expectations = (now: Date, newestIssuedAt: string | null = null) => ({ pinned, channel: "stable" as const, platform: "win-x64", newestIssuedAt, now });
const check = (signature2: unknown, now = at(DAY), newest: string | null = null, update = UPDATE) => checkFeedFreshness({ ...update, signature2 }, expectations(now, newest));

/** latest.yml as electron-updater hands it over: the parsed feed. */
const feedInfo = (signature2: unknown, version = "1.0.1") => ({ version, path: FILE, sha512, files: [{ url: FILE, sha512, size: 1 }], tavoraSignature: signUpdate(UPDATE, release.privateKey), tavoraSignature2: signature2 });

describe("checkFeedFreshness", () => {
  it("is fresh for a pinned key's statement for this channel and platform, the backup key's too", () => {
    expect(check(sign2())).toMatchObject({ status: "fresh", key: "release", statement: statement() });
    expect(check(sign2(statement(), backup.privateKey))).toMatchObject({ status: "fresh", key: "backup" });
  });

  it("is expired only a day after the expiry (clock leeway), and that is all", () => {
    expect(check(sign2(), at(31 * DAY)).status).toBe("fresh");
    expect(check(sign2(), at(31 * DAY + 1000)).status).toBe("expired");
  });

  it("can't tell when this PC's clock is more than a day before the issue time", () => {
    expect(check(sign2(), at(-DAY)).status).toBe("fresh");
    expect(check(sign2(), at(-DAY - 1000)).status).toBe("clock-behind");
  });

  it("refuses another channel or platform", () => {
    expect(check(sign2(statement({ channel: "preview" })))).toMatchObject({ status: "refused", reason: expect.stringContaining("preview channel") });
    expect(checkFeedFreshness({ ...UPDATE, signature2: sign2() }, { ...expectations(at(DAY)), platform: "win-arm64" })).toMatchObject({ status: "refused", reason: expect.stringContaining("not win-arm64") });
  });

  it("refuses a statement older than one already seen (a replay), whatever the clock says; the same one passes", () => {
    const newer = feedTime(at(DAY));
    expect(check(sign2(), at(DAY), newer)).toMatchObject({ status: "refused", reason: expect.stringContaining("before one this Tavora already saw") });
    expect(check(sign2(), at(-400 * DAY), newer).status).toBe("refused");
    expect(check(sign2(), at(DAY), feedTime(at(0))).status).toBe("fresh");
  });

  it("refuses no line, a broken one, another key's, and one for another version, file or SHA-512", () => {
    expect(check(undefined)).toMatchObject({ status: "refused", reason: expect.stringContaining("no second Tavora signature") });
    expect(check(new Date())).toMatchObject({ status: "refused" });
    expect(check("stable win-x64").status).toBe("refused");
    expect(check(sign2(statement(), stranger.privateKey)).status).toBe("refused");
    expect(check(sign2(), at(DAY), null, { ...UPDATE, version: "1.0.2" }).status).toBe("refused");
    expect(check(sign2(), at(DAY), null, { ...UPDATE, file: "Tavora-Setup-1.0.2.exe" }).status).toBe("refused");
    expect(check(sign2(), at(DAY), null, { ...UPDATE, sha512: createHash("sha512").update("x").digest("base64") }).status).toBe("refused");
  });

  it("refuses everything while the app pins no real keys", () => {
    expect(checkFeedFreshness({ ...UPDATE, signature2: sign2() }, { ...expectations(at(DAY)), pinned: { release: "", backup: "" } }).status).toBe("refused");
  });
});

describe("the helpers", () => {
  it("names this build's platform the way the feed signs it", () => {
    expect(feedPlatform("win32", "x64")).toBe("win-x64");
    expect(feedPlatform("win32", "arm64")).toBe("win-arm64");
    expect(feedPlatform("darwin", "arm64")).toBe("darwin-arm64");
  });

  it("takes the installer from the files list, else from path and sha512", () => {
    expect(feedInstaller(feedInfo("x"))).toEqual({ file: FILE, sha512 });
    expect(feedInstaller({ path: "a.exe", sha512: "b" })).toEqual({ file: "a.exe", sha512: "b" });
  });

  it("reads the saved time, and nothing from a damaged file", () => {
    expect(readNewestIssuedAt('{"newestIssuedAt":"2026-11-24T10:00:00Z"}')).toBe("2026-11-24T10:00:00Z");
    for (const text of [null, "", "{", "[]", "null", '{"newestIssuedAt":3}', '{"newestIssuedAt":"soon"}']) expect(readNewestIssuedAt(text)).toBeNull();
  });

  it("says each outcome in one log line, and which ones can't confirm Tavora is up to date", () => {
    const fresh = check(sign2());
    expect(describeFreshness(fresh)).toMatch(/^feed fresh: signed 2026-11-24T10:00:00Z, good until 2026-12-24T10:00:00Z \(release key\)$/);
    expect(describeFreshness(check(sign2(), at(40 * DAY)))).toMatch(/^feed expired/);
    expect(describeFreshness(check(undefined))).toMatch(/^feed can't be confirmed: /);
    expect([fresh, check(sign2(), at(40 * DAY)), check(sign2(), at(-2 * DAY)), check(undefined)].map(unconfirmed)).toEqual([false, true, false, true]);
  });
});

describe("FeedFreshnessCheck", () => {
  async function folder() {
    return mkdtemp(path.join(tmpdir(), "tavora-feed-"));
  }

  it("keeps the newest verified issue time across starts, and refuses an older statement after that", async () => {
    const userData = await folder();
    const first = new FeedFreshnessCheck({ userData, pinned, platform: "win-x64", now: () => at(2 * DAY) });
    await first.load();
    expect(first.check(feedInfo(sign2(statement({ issuedAt: feedTime(at(DAY)), expiresAt: feedTime(at(31 * DAY)) })))).status).toBe("fresh");
    await first.flushed();
    expect(JSON.parse(await readFile(path.join(userData, FEED_STATE_FILE), "utf8"))).toEqual({ newestIssuedAt: feedTime(at(DAY)) });

    const next = new FeedFreshnessCheck({ userData, pinned, platform: "win-x64", now: () => at(2 * DAY) });
    await next.load();
    expect(next.newestIssuedAt).toBe(feedTime(at(DAY)));
    expect(next.check(feedInfo(sign2())).status).toBe("refused");
  });

  it("never lowers it and never records a refused statement", async () => {
    const userData = await folder();
    const feed = new FeedFreshnessCheck({ userData, pinned, platform: "win-x64", now: () => at(DAY) });
    await feed.load();
    feed.check(feedInfo(sign2(statement(), stranger.privateKey)));
    expect(feed.newestIssuedAt).toBeNull();
    feed.check(feedInfo(sign2(statement({ issuedAt: feedTime(at(DAY)), expiresAt: feedTime(at(31 * DAY)) }))));
    feed.check(feedInfo(sign2()));
    expect(feed.newestIssuedAt).toBe(feedTime(at(DAY)));
  });

  it("starts from nothing with a damaged file, and keeps fields a newer Tavora added", async () => {
    const damaged = await folder();
    await writeFile(path.join(damaged, FEED_STATE_FILE), "{ broken");
    const feed = new FeedFreshnessCheck({ userData: damaged, pinned, platform: "win-x64", now: () => at(DAY) });
    await feed.load();
    expect(feed.newestIssuedAt).toBeNull();

    const newer = await folder();
    await writeFile(path.join(newer, FEED_STATE_FILE), JSON.stringify({ newestIssuedAt: feedTime(at(-DAY)), later: { kept: true } }));
    const kept = new FeedFreshnessCheck({ userData: newer, pinned, platform: "win-x64", now: () => at(DAY) });
    await kept.load();
    kept.check(feedInfo(sign2()));
    await kept.flushed();
    expect(JSON.parse(await readFile(path.join(newer, FEED_STATE_FILE), "utf8"))).toEqual({ newestIssuedAt: feedTime(at(0)), later: { kept: true } });
  });

  it("checks a download against the file it saved, through checkDownloadedUpdate", async () => {
    const dir = await folder();
    const file = path.join(dir, FILE);
    await writeFile(file, "installer");
    const feed = new FeedFreshnessCheck({ userData: dir, pinned, platform: "win-x64", now: () => at(DAY) });
    const info = { ...feedInfo(sign2()), downloadedFile: file };
    expect(await checkDownloadedUpdate(info, pinned, "1.0.0", (installer) => feed.check(info, installer))).toMatchObject({ ok: true, key: "release", feed: { status: "fresh" } });
    // The feed signs another installer than the one saved: v1 already refuses it, and the feed check doesn't run.
    await writeFile(file, "something else");
    expect(await checkDownloadedUpdate(info, pinned, "1.0.0", (installer) => feed.check(info, installer))).toMatchObject({ ok: false });
    // A broken second line never changes v1's answer here.
    await writeFile(file, "installer");
    const broken = { ...info, tavoraSignature2: "nope" };
    expect(await checkDownloadedUpdate(broken, pinned, "1.0.0", (installer) => feed.check(broken, installer))).toMatchObject({ ok: true, feed: { status: "refused" } });
    expect(await checkDownloadedUpdate(broken, pinned, "1.0.0")).toEqual({ ok: true, key: "release" });
  });
});

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  requestHeaders: Record<string, string> | null = null;
  /** What the next check answers with. */
  answer: { event: "update-available" | "update-not-available"; info: Record<string, unknown> } | null = null;
  async checkForUpdates() {
    if (this.answer) this.emit(this.answer.event, this.answer.info);
  }
  async downloadUpdate() {}
  quitAndInstall() {}
  install() {
    return true;
  }
}

function manager({ enforce, verify = async () => ({ ok: true, key: "release" }) as UpdateCheck, now = at(DAY) }: { enforce: boolean; verify?: () => Promise<UpdateCheck>; now?: Date }) {
  const updater = new FakeUpdater();
  const logs: string[] = [];
  const states: UpdateState[] = [];
  const refused: unknown[] = [];
  const feed = new FeedFreshnessCheck({ userData: path.join(tmpdir(), `tavora-feed-unused-${Math.random()}`), pinned, platform: "win-x64", now: () => now });
  const m = new UpdateManager({
    updater: updater as unknown as UpdaterLike,
    verify,
    checkFeed: (info) => feed.check(info),
    enforceFeed: enforce,
    onRefused: (info) => refused.push(info),
    autoDownload: false,
    onChange: (s) => states.push(s),
    log: (line) => logs.push(line),
    now: () => now,
  });
  return { updater, m, logs, states, refused };
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("UpdateManager and the feed check", () => {
  it("this release only reports: the switch is off", () => {
    expect(ENFORCE_FEED_FRESHNESS).toBe(false);
  });

  it("report-only: an answer whose feed can't be confirmed still ends as up to date, with the outcome in the log", async () => {
    for (const signature2 of [undefined, "broken", sign2(statement(), stranger.privateKey), sign2(statement({ channel: "preview" }))]) {
      const { updater, m, logs } = manager({ enforce: false });
      updater.answer = { event: "update-not-available", info: feedInfo(signature2) };
      await m.check();
      expect(m.state).toMatchObject({ status: "idle", failed: false });
      expect(logs.at(-1)).toMatch(/^up to date; feed can't be confirmed: /);
    }
    const expired = manager({ enforce: false, now: at(40 * DAY) });
    expired.updater.answer = { event: "update-not-available", info: feedInfo(sign2()) };
    await expired.m.check();
    expect(expired.m.state).toMatchObject({ status: "idle", failed: false });
    expect(expired.logs.at(-1)).toMatch(/^up to date; feed expired: /);
  });

  it("report-only: a fresh feed is logged on the same line, so repeated checks write it once", async () => {
    const { updater, m, logs } = manager({ enforce: false });
    updater.answer = { event: "update-not-available", info: feedInfo(sign2()) };
    await m.check();
    await m.check();
    expect(logs).toEqual(["up to date; feed fresh: signed 2026-11-24T10:00:00Z, good until 2026-12-24T10:00:00Z (release key)"]);
  });

  it("report-only: a downloaded version whose feed is refused still installs, and the log says so", async () => {
    const feedResult = check("broken");
    const { updater, m, logs, refused } = manager({ enforce: false, verify: async () => ({ ok: true, key: "release", feed: feedResult }) });
    updater.emit("update-downloaded", { version: "1.0.1", downloadedFile: FILE });
    await settle();
    expect(m.state.status).toBe("ready");
    expect(refused).toEqual([]);
    expect(logs.at(-1)).toMatch(/^update 1\.0\.1 signature checked \(release key\); feed can't be confirmed: /);
  });

  it("report-only: an update found is logged with its feed's outcome", async () => {
    const { updater, m, logs } = manager({ enforce: false });
    updater.answer = { event: "update-available", info: feedInfo(sign2()) };
    await m.check();
    expect(logs.at(-1)).toMatch(/^update 1\.0\.1 available; feed fresh: /);
  });

  it("enforced (the next release): an unconfirmed or expired feed says so; a fresh one is up to date", async () => {
    for (const [signature2, now, failed] of [
      [undefined, at(DAY), "unconfirmed"],
      [sign2(), at(40 * DAY), "unconfirmed"],
      [sign2(), at(DAY), false],
      [sign2(), at(-3 * DAY), false],
    ] as const) {
      const { updater, m } = manager({ enforce: true, now });
      updater.answer = { event: "update-not-available", info: feedInfo(signature2) };
      await m.check();
      expect(m.state).toMatchObject({ status: "idle", failed });
    }
  });

  it("enforced: a download whose feed is refused is refused; an expired one still installs (soft expiry)", async () => {
    const bad = manager({ enforce: true, verify: async () => ({ ok: true, key: "release", feed: check("broken") }) });
    bad.updater.emit("update-downloaded", { version: "1.0.1", downloadedFile: FILE });
    await settle();
    expect(bad.m.state).toMatchObject({ status: "available", failed: "refused" });
    expect(bad.refused).toHaveLength(1);

    const expired = manager({ enforce: true, verify: async () => ({ ok: true, key: "release", feed: check(sign2(), at(40 * DAY)) }) });
    expired.updater.emit("update-downloaded", { version: "1.0.1", downloadedFile: FILE });
    await settle();
    expect(expired.m.state.status).toBe("ready");
  });

  it("an answer without the feed (the preview's end) is up to date, with nothing to check", async () => {
    const { updater, m, logs } = manager({ enforce: true });
    updater.emit("update-not-available");
    expect(m.state).toMatchObject({ status: "idle", failed: false });
    expect(logs.at(-1)).toBe("up to date");
  });
});
