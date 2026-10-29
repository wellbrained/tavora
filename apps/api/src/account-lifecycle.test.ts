import { createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { accountLifecycle, type AccountStores } from "./account-lifecycle.ts";
import { AccountStore } from "./account-store.ts";
import { ActivityLog } from "./activity-log.ts";
import { createAdminApp } from "./admin-app.ts";
import { createApp } from "./app.ts";
import { CatalogStore } from "./catalog.ts";
import { ConversationStore } from "./conversations.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { IconState } from "./icon-state.ts";
import { createTestInbox } from "./mail.ts";
import { keyFingerprint } from "./publishers.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { ReviewStore } from "./reviews.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });
const rawKey = (key: KeyObject) => createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12);
const DAY = 24 * 3_600_000;
const ADMIN = "a".repeat(24);
const VERSIONS = { tavora: "0.22.0", module: "1.0.0" };

function moduleZip(key: KeyObject, id = "wellbrained.timer"): Buffer {
  const manifest = { id, name: "Timer", version: "1.0.0", apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } };
  const files: ZipFile[] = [{ name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) }, { name: "index.html", data: Buffer.from("<p>timer</p>") }];
  return writeZip([...files, signFiles(files, key)]);
}

function setup() {
  const store = new AccountStore(":memory:");
  const reviews = new ReviewStore(":memory:");
  const conversations = new ConversationStore(":memory:");
  const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-lifecycle-")));
  const inbox = createTestInbox();
  const clock = { now: Date.parse("2026-10-29T12:00:00Z") };
  const key = generateKeyPairSync("ed25519").privateKey;
  catalog.add(moduleZip(key));
  const developer = store.createAccount({ email: "dev@example.com" }, clock.now - 5 * DAY);
  store.setDeveloperName(developer.id, "Wellbrained", clock.now - 5 * DAY);
  store.linkKey(developer.id, keyFingerprint(rawKey(key)), rawKey(key).toString("base64"), clock.now);
  const lifecycle = accountLifecycle({ accounts: store, catalog, copies: undefined, reviews, conversations, leaderboards: undefined, icons: undefined });
  const app = createApp({
    db,
    catalog,
    rateLimiter: roomy(),
    reviewRateLimiter: roomy(),
    conversationRateLimiter: roomy(),
    accounts: { store, mailer: inbox, reviews, conversations, catalog, lifecycle, now: () => clock.now },
  });
  const admin = createAdminApp({
    token: ADMIN,
    submissions: { listPending: () => [] } as never,
    state: {} as never,
    store: { list: () => [] } as never,
    catalog,
    accounts: store,
    reviews,
    conversations,
    activity: new ActivityLog(":memory:"),
    lifecycle,
    moderation: { mailer: inbox, now: () => clock.now },
  });
  const user = (email: string) => {
    const account = store.createAccount({ email }, clock.now - DAY);
    return { account, token: store.createSession(account.id, "windows", clock.now).token };
  };
  const call = (method: string, pathname: string, token?: string | null, body?: unknown) =>
    app.request(`http://tavora.test${pathname}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const adminCall = (pathname: string, body: unknown) =>
    admin.request(`http://admin.test${pathname}`, { method: "POST", headers: { "x-admin-token": ADMIN, "content-type": "application/json" }, body: JSON.stringify(body) });
  const devToken = () => store.createSession(developer.id, "windows", clock.now).token;
  const start = (token: string) => call("POST", "/v1/conversations", token, { moduleId: "wellbrained.timer", type: "bug", text: "It crashes when I press Start.", versions: VERSIONS });
  const reason = async (response: Response) => ((await response.json()) as { reason?: string }).reason;
  const contact = async () => ((await (await call("GET", "/v1/catalog/modules/wellbrained.timer")).json()) as { module: { contact?: unknown } }).module.contact;
  return { store, reviews, conversations, catalog, clock, developer, devToken, user, call, adminCall, start, reason, contact };
}

describe("deleting an account", () => {
  it("reaches every store that keeps something of it", () => {
    const calls: string[] = [];
    // Every store as a stand-in that notes which of its methods were called with the account.
    const record = (name: string) => new Proxy({}, { get: (_target, method) => (...args: unknown[]) => void calls.push(`${name}.${String(method)}(${args[0]})`) });
    const stores = { accounts: record("accounts"), catalog: record("catalog"), copies: record("copies"), reviews: record("reviews"), conversations: record("conversations"), leaderboards: record("leaderboards"), icons: record("icons") } as unknown as AccountStores;
    accountLifecycle(stores).delete("acc", 1);
    expect(calls.sort()).toEqual(
      ["accounts.deleteAccount(acc)", "catalog.forgetReporter(acc)", "conversations.forget(acc)", "copies.remove(acc)", "icons.forgetSender(acc)", "leaderboards.forget(acc)", "reviews.forget(acc)"].sort(),
    );
  });

  it("drops the account's waiting icon offers and its block, and nobody else's", () => {
    const icons = new IconState(":memory:");
    const offer = (sha256: string, sender: string) => icons.addPending({ sha256, id: "elden-ring", name: "Elden Ring", source: "upload", bytes: new Uint8Array([1, 2, 3]), sender, now: new Date() });
    offer("a".repeat(64), "gone");
    offer("b".repeat(64), "stays");
    icons.blockSender("blocked", new Date());
    accountLifecycle({ accounts: new AccountStore(":memory:"), catalog: undefined, copies: undefined, reviews: undefined, conversations: undefined, leaderboards: undefined, icons }).delete("gone", 1);
    accountLifecycle({ accounts: new AccountStore(":memory:"), catalog: undefined, copies: undefined, reviews: undefined, conversations: undefined, leaderboards: undefined, icons }).delete("blocked", 1);
    expect(icons.pendingCountFrom("gone")).toBe(0);
    expect(icons.pendingCountFrom("stays")).toBe(1);
    expect(icons.isSenderBlocked("blocked")).toBe(false);
  });

  it("is what the server's every store is registered for", () => {
    // A new store in server.ts that keeps account data must be added to AccountStores (or listed here with why not).
    const source = readFileSync(path.join(import.meta.dirname, "server.ts"), "utf8").replace(/\r\n/g, "\n");
    const opened = [...source.matchAll(/new (\w+)\(path\.join\(stateDir/g)].map((match) => match[1]).sort();
    const inLifecycle = { AccountStore: "accounts", CatalogStore: "catalog", CopyStore: "copies", ReviewStore: "reviews", ConversationStore: "conversations", LeaderboardStore: "leaderboards", IconState: "icons" };
    // Daily totals keep nothing about a person; the activity log is the maintainer's own record and holds only ids;
    // the country lookup is a read-only map of IP ranges to countries.
    const noAccountData = ["StatsStore", "ActivityLog", "CountryLookup"];
    expect(opened).toEqual([...Object.keys(inLifecycle), ...noAccountData].sort());
    const built = /accountLifecycle\(\{([^}]*)\}\)/.exec(source)?.[1] ?? "";
    for (const key of Object.values(inLifecycle)) expect(built).toMatch(new RegExp(`\\b${key}\\b`));
    expect(source).toMatch(/\.\.\.\(lifecycle \? \{ lifecycle \} : \{\}\),\n\s*\.\.\.\(mailDailyLimit/);
    expect(source.match(/\.\.\.\(lifecycle \? \{ lifecycle \} : \{\}\)/g)).toHaveLength(2);
  });
});

describe("suspending an account", () => {
  it("takes no new conversations for its modules while suspended, keeps the link, and takes them again after", async () => {
    const { developer, user, start, reason, contact, adminCall, call, devToken } = setup();
    await call("PUT", "/v1/catalog/modules/wellbrained.timer/contact", devToken(), { enabled: true, link: "https://github.com/wellbrained/timer/issues" });
    const mara = user("mara@example.com");
    expect((await adminCall("/api/accounts/suspend", { id: developer.id, reason: "spam" })).status).toBe(200);
    const refused = await start(mara.token);
    expect(refused.status).toBe(403);
    expect(await reason(refused)).toBe("contact-off");
    expect(await contact()).toEqual({ enabled: false, link: "https://github.com/wellbrained/timer/issues" });

    expect((await adminCall("/api/accounts/unsuspend", { id: developer.id })).status).toBe(200);
    expect(await contact()).toEqual({ enabled: true, link: "https://github.com/wellbrained/timer/issues" });
    expect((await start(mara.token)).status).toBe(201);
  });
});

describe("banning a developer", () => {
  it("closes their conversations as Tavora, hides the link, stops them acting as publisher, and an unban relists without reopening", async () => {
    const { store, reviews, catalog, clock, developer, devToken, user, call, adminCall, start, reason, contact } = setup();
    const token = devToken();
    await call("PUT", "/v1/catalog/modules/wellbrained.timer/contact", token, { enabled: true, link: "https://github.com/wellbrained/timer/issues" });
    const mara = user("mara@example.com");
    const opened = ((await (await start(mara.token)).json()) as { conversation: { id: string } }).conversation.id;
    const review = reviews.rate(mara.account.id, "wellbrained.timer", { stars: 4, text: "Nice timer.", version: "1.0.0" }, clock.now);

    const answer = await adminCall("/api/moderation/ban", { accountId: developer.id, reason: "spam" });
    expect(await answer.json()).toMatchObject({ ok: true, unlisted: ["wellbrained.timer"], closedConversations: 1 });
    const detail = (await (await call("GET", `/v1/conversations/${opened}`, mara.token)).json()) as { conversation: { state: string; closeReason: string } };
    expect(detail.conversation).toMatchObject({ state: "closed", closeReason: "tavora" });

    // Should a module of theirs be listed again by hand, they still don't act as its publisher and show no link.
    catalog.setListed("wellbrained.timer", true);
    expect(await contact()).toEqual({ enabled: false, link: null });
    expect(await reason(await call("PUT", "/v1/catalog/modules/wellbrained.timer/contact", token, { enabled: true, link: null }))).toBe("banned");
    expect(await reason(await call("PUT", `/v1/catalog/reviews/${review.id}/reply`, token, { text: "Thanks!" }))).toBe("banned");
    expect(await reason(await start(user("lea@example.com").token))).toBe("contact-off");
    catalog.setListed("wellbrained.timer", false);

    const unbanned = await adminCall("/api/moderation/unban", { accountId: developer.id });
    expect(await unbanned.json()).toMatchObject({ ok: true, relisted: ["wellbrained.timer"] });
    expect(store.isBanned(developer.id)).toBe(false);
    expect(await contact()).toEqual({ enabled: true, link: "https://github.com/wellbrained/timer/issues" });
    const after = (await (await call("GET", `/v1/conversations/${opened}`, mara.token)).json()) as { conversation: { state: string } };
    expect(after.conversation.state).toBe("closed");
  });
});
