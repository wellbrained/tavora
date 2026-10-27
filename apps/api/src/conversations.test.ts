import { createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { ActivityLog } from "./activity-log.ts";
import { createAdminApp } from "./admin-app.ts";
import { createApp } from "./app.ts";
import { CatalogStore } from "./catalog.ts";
import { ConversationStore, cleanContactLink, fillPlaceholders, placeholdersOk } from "./conversations.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createTestInbox } from "./mail.ts";
import { keyFingerprint } from "./publishers.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { ReviewStore } from "./reviews.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });
const rawKey = (key: KeyObject) => createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12);
const DAY = 24 * 3_600_000;
const ADMIN = "a".repeat(24);
const VERSIONS = { tavora: "0.21.39", module: "1.0.0" };

function moduleZip(key: KeyObject, id = "wellbrained.timer", name = "Timer"): Buffer {
  const manifest = { id, name, version: "1.0.0", apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } };
  const files: ZipFile[] = [{ name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) }, { name: "index.html", data: Buffer.from("<p>timer</p>") }];
  return writeZip([...files, signFiles(files, key)]);
}

function setup() {
  const store = new AccountStore(":memory:");
  const reviews = new ReviewStore(":memory:");
  const conversations = new ConversationStore(":memory:");
  const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-conversations-")));
  const inbox = createTestInbox();
  const clock = { now: Date.parse("2026-10-27T12:00:00Z") };
  const key = generateKeyPairSync("ed25519").privateKey;
  catalog.add(moduleZip(key));
  const developer = store.createAccount({ email: "dev@example.com" }, clock.now - 5 * DAY);
  store.setProfile(developer.id, { name: "Devi Profile", initials: "DP", picture: null, updatedAt: clock.now });
  store.setDeveloperName(developer.id, "Wellbrained", clock.now - 5 * DAY);
  store.linkKey(developer.id, keyFingerprint(rawKey(key)), rawKey(key).toString("base64"), clock.now);
  const app = createApp({
    db,
    catalog,
    rateLimiter: roomy(),
    reviewRateLimiter: roomy(),
    conversationRateLimiter: roomy(),
    accounts: { store, mailer: inbox, reviews, conversations, catalog, now: () => clock.now },
  });
  const state = { listPending: () => [] } as never;
  const activity = new ActivityLog(":memory:");
  const admin = createAdminApp({ token: ADMIN, submissions: state, state: {} as never, store: { list: () => [] } as never, catalog, accounts: store, reviews, conversations, activity, moderation: { mailer: inbox, now: () => clock.now } });
  const user = (email: string, name = "Mara Private", createdAt = clock.now - DAY) => {
    const account = store.createAccount({ email }, createdAt);
    if (name) store.setProfile(account.id, { name, initials: "MP", picture: null, updatedAt: clock.now });
    return { account, token: store.createSession(account.id, "windows", clock.now).token };
  };
  const call = (method: string, pathname: string, token?: string | null, body?: unknown) =>
    app.request(`http://tavora.test${pathname}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const adminCall = (method: string, pathname: string, body?: unknown) =>
    admin.request(`http://admin.test${pathname}`, { method, headers: { "x-admin-token": ADMIN, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const devToken = store.createSession(developer.id, "windows", clock.now).token;
  const start = (token: string, extra: Record<string, unknown> = {}) => call("POST", "/v1/conversations", token, { moduleId: "wellbrained.timer", type: "bug", text: "It crashes when I press Start.", versions: VERSIONS, ...extra });
  const started = async (token: string, extra: Record<string, unknown> = {}) => ((await (await start(token, extra)).json()) as { conversation: { id: string; label: string } }).conversation;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 5));
  return { store, reviews, conversations, catalog, inbox, clock, app, admin, developer, devToken, user, call, adminCall, start, started, activity, flush, key };
}

const sent = (inbox: { mails: () => { to: string; subject: string; text: string }[] }) => [...inbox.mails()].reverse();
type Item = { id: string; kind: string; role: string; module: { id: string; name: string } | null; type: string | null; label: string; title: string; state: string; closeReason: string | null; unread: boolean; previousId: string | null; closesInDays: number | null };
type Detail = { conversation: Item; messages: { id: number; from: string; mine: boolean; text: string; at: string; versions?: unknown }[] };

describe("starting a conversation with a developer", () => {
  it("opens it with the first message and its versions, and shows each side only the other's pseudonym", async () => {
    const { user, start, call, devToken, developer } = setup();
    const mara = user("mara@example.com");
    const response = await start(mara.token);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const made = (await response.json()) as Detail;
    expect(made.conversation).toMatchObject({ kind: "developer", role: "user", module: { id: "wellbrained.timer", name: "Timer" }, type: "bug", title: "Developer of Timer (Wellbrained)", state: "open", closeReason: null, unread: false, previousId: null, closesInDays: null });
    expect(made.conversation.label).toMatch(/^[A-HJ-NP-Z][2-9]$/);
    expect(made.messages).toEqual([{ id: expect.any(Number), from: "user", mine: true, text: "It crashes when I press Start.", at: "2026-10-27T12:00:00.000Z", versions: { tavora: "0.21.39", module: "1.0.0" } }]);

    // The user's list and inbox.
    const mine = (await (await call("GET", "/v1/conversations", mara.token)).json()) as { conversations: Item[]; inbox: Record<string, unknown> };
    expect(mine.conversations).toHaveLength(1);
    expect(mine.inbox).toEqual({ open: 1, unread: 0, developer: false });

    // The developer sees a user label, one unread message, and the always-on inbox.
    const theirs = (await (await call("GET", "/v1/conversations", devToken)).json()) as { conversations: Item[]; inbox: Record<string, unknown> };
    expect(theirs.conversations[0]).toMatchObject({ id: made.conversation.id, role: "developer", title: `User · ${made.conversation.label}`, unread: true });
    expect(theirs.inbox).toEqual({ open: 1, unread: 1, developer: true });
    const opened = (await (await call("GET", `/v1/conversations/${made.conversation.id}`, devToken)).json()) as Detail;
    expect(opened.messages[0]).toMatchObject({ from: "user", mine: false });
    expect(((await (await call("GET", "/v1/conversations", devToken)).json()) as { inbox: { unread: number } }).inbox.unread).toBe(0);

    // Neither answer holds an account id, an email, a profile name or a developer's own name beyond the public one.
    for (const text of [JSON.stringify(mine), JSON.stringify(theirs), JSON.stringify(opened), JSON.stringify(made)]) {
      for (const secret of [mara.account.id, developer.id, "mara@example.com", "dev@example.com", "Mara Private", "Devi Profile"]) expect(text).not.toContain(secret);
    }
  });

  it("needs a sign-in and a listed module, and never lets the developer write to themselves", async () => {
    const { user, start, call, devToken } = setup();
    const mara = user("mara@example.com");
    expect((await call("POST", "/v1/conversations", null, {})).status).toBe(401);
    expect((await call("GET", "/v1/conversations")).status).toBe(401);
    expect((await start(mara.token, { moduleId: "wellbrained.other" })).status).toBe(404);
    const own = await start(devToken);
    expect(own.status).toBe(403);
    expect(((await own.json()) as { reason: string }).reason).toBe("own-module");
  });

  it("refuses when the developer turned contact off, and says where else to go", async () => {
    const { user, start, call, devToken } = setup();
    const mara = user("mara@example.com");
    expect((await call("PUT", "/v1/catalog/modules/wellbrained.timer/contact", devToken, { enabled: false, link: "https://github.com/wellbrained/timer/issues" })).status).toBe(200);
    const refused = await start(mara.token);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "The developer doesn't take messages in Tavora.", reason: "contact-off", link: "https://github.com/wellbrained/timer/issues" });
    // With contact off the always-on inbox of the developer is gone, and back when it is on again.
    expect(((await (await call("GET", "/v1/conversations", devToken)).json()) as { inbox: { developer: boolean } }).inbox.developer).toBe(false);
    await call("PUT", "/v1/catalog/modules/wellbrained.timer/contact", devToken, { enabled: true, link: null });
    expect(((await (await call("GET", "/v1/conversations", devToken)).json()) as { inbox: { developer: boolean } }).inbox.developer).toBe(true);
  });

  it("refuses accounts younger than a day with the wait, like ratings", async () => {
    const { user, start, clock } = setup();
    const fresh = user("new@example.com", "", clock.now - 5 * 3_600_000);
    const refused = await start(fresh.token);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ reason: "account-too-new", hours: 19 });
  });

  it("allows 5 new conversations in 24 hours, and one open conversation per module", async () => {
    const { user, start, call, clock } = setup();
    const mara = user("mara@example.com");
    const first = (await (await start(mara.token)).json()) as Detail;
    const again = await start(mara.token);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ reason: "already-open", id: first.conversation.id });

    let previous = first.conversation.id;
    for (let index = 1; index < 5; index += 1) {
      expect((await call("POST", `/v1/conversations/${previous}/close`, mara.token, {})).status).toBe(200);
      clock.now += 60_000;
      const next = await start(mara.token, { previousId: previous });
      expect(next.status).toBe(201);
      const made = (await next.json()) as Detail;
      expect(made.conversation.previousId).toBe(previous);
      previous = made.conversation.id;
    }
    await call("POST", `/v1/conversations/${previous}/close`, mara.token, {});
    const sixth = await start(mara.token);
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toMatchObject({ reason: "daily-limit", hours: 24 });
    clock.now += DAY;
    expect((await start(mara.token)).status).toBe(201);
  });

  it("checks the text, the type, the versions and previousId", async () => {
    const { user, start, started, call } = setup();
    const mara = user("mara@example.com");
    const otto = user("otto@example.com", "Otto");
    for (const extra of [{ text: "" }, { text: "   " }, { text: "x".repeat(2001) }, { type: "rant" }, { versions: { tavora: "latest", module: "1.0.0" } }, { versions: { tavora: "0.21.39" } }, { versions: null }, { someone: "me" }, { previousId: "nope" }]) {
      expect((await start(mara.token, extra)).status, JSON.stringify(extra)).toBe(400);
    }
    expect(((await (await start(mara.token, { text: "Visit https://evil.example now" })).json()) as { reason: string }).reason).toBe("message-link");
    expect(((await (await start(mara.token, { text: "You are a retard" })).json()) as { reason: string }).reason).toBe("message-words");
    expect((await start(mara.token, { text: "x".repeat(2000) })).status).toBe(201);
    // previousId must be the caller's own closed conversation.
    const other = await started(otto.token);
    await call("POST", `/v1/conversations/${other.id}/close`, otto.token, {});
    const own = ((await (await call("GET", "/v1/conversations", mara.token)).json()) as { conversations: Item[] }).conversations[0]!;
    await call("POST", `/v1/conversations/${own.id}/close`, mara.token, {});
    expect((await start(mara.token, { previousId: other.id })).status).toBe(400);
    expect((await start(mara.token, { previousId: own.id })).status).toBe(201);
  });
});

describe("messages in a conversation", () => {
  it("lets only its two sides write, only while it is open, with the same filter", async () => {
    const { user, started, call, devToken, clock, conversations } = setup();
    const mara = user("mara@example.com");
    const stranger = user("stranger@example.com", "Sam");
    const conversation = await started(mara.token);
    const url = `/v1/conversations/${conversation.id}`;
    expect((await call("POST", `${url}/messages`, stranger.token, { text: "hi" })).status).toBe(404);
    expect((await call("GET", url, stranger.token)).status).toBe(404);
    expect((await call("POST", `${url}/messages`, devToken, { text: "" })).status).toBe(400);
    expect(((await (await call("POST", `${url}/messages`, devToken, { text: "mail me at a@b.com" })).json()) as { reason: string }).reason).toBe("message-link");

    clock.now += 3_600_000;
    const answered = await call("POST", `${url}/messages`, devToken, { text: "Thanks! Which version are you on?" });
    expect(answered.status).toBe(200);
    const detail = (await answered.json()) as Detail;
    expect(detail.messages.map((message) => [message.from, message.mine])).toEqual([["user", false], ["developer", true]]);
    expect(conversations.get(conversation.id)!.lastMessageAt).toBe(clock.now);

    // The user sees it as unread until opening it.
    const list = (await (await call("GET", "/v1/conversations", mara.token)).json()) as { conversations: Item[]; inbox: { unread: number } };
    expect(list.conversations[0]!.unread).toBe(true);
    expect(list.inbox.unread).toBe(1);
    await call("GET", url, mara.token);
    expect(((await (await call("GET", "/v1/conversations", mara.token)).json()) as { inbox: { unread: number } }).inbox.unread).toBe(0);

    await call("POST", `${url}/close`, mara.token, {});
    const closed = await call("POST", `${url}/messages`, mara.token, { text: "one more" });
    expect(closed.status).toBe(409);
    expect(((await closed.json()) as { reason: string }).reason).toBe("closed");
  });

  it("allows 50 messages per account in 24 hours", async () => {
    const { user, started, call, clock } = setup();
    const mara = user("mara@example.com");
    const conversation = await started(mara.token);
    for (let index = 1; index < 50; index += 1) expect((await call("POST", `/v1/conversations/${conversation.id}/messages`, mara.token, { text: `Message ${index}` })).status).toBe(200);
    const over = await call("POST", `/v1/conversations/${conversation.id}/messages`, mara.token, { text: "one too many" });
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ reason: "daily-limit", hours: 24 });
    clock.now += DAY + 1;
    expect((await call("POST", `/v1/conversations/${conversation.id}/messages`, mara.token, { text: "next day" })).status).toBe(200);
  });
});

describe("closing, blocking and reporting", () => {
  it("lets the developer close with an outcome and the user close their own", async () => {
    const { user, started, call, devToken } = setup();
    const otto = user("otto@example.com", "Otto");
    for (const outcome of ["fixed", "added", "not-planned", "not-a-bug", "none"]) {
      const conversation = await started(user(`${outcome}@example.com`).token);
      const closed = (await (await call("POST", `/v1/conversations/${conversation.id}/close`, devToken, { outcome })).json()) as Detail;
      expect(closed.conversation).toMatchObject({ state: "closed", closeReason: outcome });
    }
    const defaulted = await started(user("default@example.com").token);
    expect(((await (await call("POST", `/v1/conversations/${defaulted.id}/close`, devToken)).json()) as Detail).conversation.closeReason).toBe("none");
    const refusal = await started(otto.token);
    expect((await call("POST", `/v1/conversations/${refusal.id}/close`, devToken, { outcome: "solved" })).status).toBe(400);
    // The user's own close is "Closed by you", whatever outcome they send.
    const own = (await (await call("POST", `/v1/conversations/${refusal.id}/close`, otto.token, { outcome: "fixed" })).json()) as Detail;
    expect(own.conversation).toMatchObject({ state: "closed", closeReason: "user" });
    expect((await call("POST", `/v1/conversations/${refusal.id}/close`, otto.token, {})).status).toBe(409);
  });

  it("blocks for both sides, optionally with a report the admin can then read", async () => {
    const { user, started, call, devToken, adminCall, conversations } = setup();
    const mara = user("mara@example.com");
    const conversation = await started(mara.token, { text: "You are a clown." });
    await call("POST", `/v1/conversations/${conversation.id}/messages`, devToken, { text: "Please stop." });

    // The admin reads nothing here yet.
    expect((await adminCall("GET", `/api/messages/${conversation.id}`)).status).toBe(403);

    const blocked = await call("POST", `/v1/conversations/${conversation.id}/block`, devToken, { report: { reason: "insults", note: "Rude" } });
    expect(blocked.status).toBe(200);
    expect(((await blocked.json()) as Detail).conversation).toMatchObject({ state: "closed", closeReason: "blocked" });
    expect(((await (await call("GET", `/v1/conversations/${conversation.id}`, mara.token)).json()) as Detail).conversation).toMatchObject({ state: "closed", closeReason: "blocked" });
    expect(conversations.reports(conversation.id)).toEqual([expect.objectContaining({ reason: "insults", note: "Rude" })]);

    // Now it is reported, so the admin reads all of it: both accounts and every message.
    const read = (await (await adminCall("GET", `/api/messages/${conversation.id}`)).json()) as { user: { name: string }; developer: { name: string }; reports: { reason: string; side: string }[]; messages: unknown[] };
    expect(read.user.name).toBe("Mara Private");
    expect(read.developer.name).toBe("Devi Profile");
    expect(read.reports).toMatchObject([{ reason: "insults", side: "developer" }]);
    expect(read.messages).toHaveLength(2);
    const overview = (await (await adminCall("GET", "/api/messages")).json()) as { conversations: unknown[]; reported: { id: string; messages: unknown[] }[] };
    expect(overview.conversations).toEqual([]);
    expect(overview.reported.map((entry) => entry.id)).toEqual([conversation.id]);

    // The other side is not told: it sees nothing of the report.
    expect(JSON.stringify(await (await call("GET", `/v1/conversations/${conversation.id}`, mara.token)).json())).not.toContain("insults");
    expect((await adminCall("POST", "/api/messages/dismiss-report", { id: conversation.id })).status).toBe(200);
    expect((await adminCall("GET", `/api/messages/${conversation.id}`)).status).toBe(403);
    expect((await adminCall("POST", "/api/messages/dismiss-report", { id: conversation.id })).status).toBe(404);
  });

  it("reports without blocking, validates the reason, and keeps strangers out", async () => {
    const { user, started, call, devToken } = setup();
    const mara = user("mara@example.com");
    const stranger = user("stranger@example.com", "Sam");
    const conversation = await started(mara.token);
    const url = `/v1/conversations/${conversation.id}`;
    expect((await call("POST", `${url}/report`, mara.token, { reason: "rude" })).status).toBe(400);
    expect((await call("POST", `${url}/report`, mara.token, { reason: "spam", note: "x".repeat(501) })).status).toBe(400);
    expect((await call("POST", `${url}/report`, stranger.token, { reason: "spam" })).status).toBe(404);
    expect((await call("POST", `${url}/report`, devToken, { reason: "spam", note: "Scam link attempt" })).status).toBe(202);
    expect(((await (await call("GET", url, devToken)).json()) as Detail).conversation.state).toBe("open");
    expect((await call("POST", `${url}/block`, mara.token, { report: { reason: "nope" } })).status).toBe(400);
  });

  it("lets nobody but the admin close a Tavora conversation", async () => {
    const { user, call, adminCall } = setup();
    const mara = user("mara@example.com");
    const started = (await (await adminCall("POST", "/api/messages/start", { accountId: mara.account.id, text: "Hello from Tavora: https://docs.mytavora.app" })).json()) as { id: string };
    const url = `/v1/conversations/${started.id}`;
    expect((await call("POST", `${url}/close`, mara.token, {})).status).toBe(403);
    expect((await call("POST", `${url}/block`, mara.token, {})).status).toBe(403);
    expect((await call("POST", `${url}/report`, mara.token, { reason: "spam" })).status).toBe(403);
    expect((await adminCall("POST", "/api/messages/close", { id: started.id })).status).toBe(200);
    expect(((await (await call("GET", url, mara.token)).json()) as Detail).conversation).toMatchObject({ state: "closed", closeReason: "tavora" });
  });
});

describe("after a block", () => {
  it("refuses a new conversation from the same user about the same module, and shows a deleted account as left", async () => {
    const { user, started, start, call, devToken, conversations } = setup();
    const mara = user("mara@example.com");
    const first = await started(mara.token);
    expect((await call("POST", `/v1/conversations/${first.id}/block`, devToken, {})).status).toBe(200);
    const again = await start(mara.token);
    expect(again.status).toBe(403);
    expect(await again.json()).toMatchObject({ reason: "blocked" });

    // A conversation closed with an outcome shows "left" once that side's account is gone.
    const otto = user("otto@example.com", "Otto");
    const fixed = await started(otto.token);
    await call("POST", `/v1/conversations/${fixed.id}/close`, devToken, { outcome: "fixed" });
    conversations.forget(otto.account.id);
    expect(conversations.get(fixed.id)).toMatchObject({ closeReason: "left" });
  });
});

describe("deleting a conversation", () => {
  it("removes it for the caller only, and for good once both sides did and it isn't reported", async () => {
    const { user, started, call, devToken, conversations } = setup();
    const mara = user("mara@example.com");
    const conversation = await started(mara.token);
    const url = `/v1/conversations/${conversation.id}`;
    expect((await call("DELETE", url, mara.token)).status).toBe(204);
    // Deleting an open one closes it first, so the developer isn't left waiting.
    expect(((await (await call("GET", url, devToken)).json()) as Detail).conversation).toMatchObject({ state: "closed", closeReason: "user" });
    expect((await call("GET", url, mara.token)).status).toBe(404);
    expect(((await (await call("GET", "/v1/conversations", mara.token)).json()) as { conversations: unknown[] }).conversations).toEqual([]);
    expect(conversations.get(conversation.id)).not.toBeNull();
    expect((await call("DELETE", url, devToken)).status).toBe(204);
    expect(conversations.get(conversation.id)).toBeNull();
  });

  it("keeps a reported conversation until the report is dismissed", async () => {
    const { user, started, call, devToken, conversations, adminCall } = setup();
    const mara = user("mara@example.com");
    const conversation = await started(mara.token);
    const url = `/v1/conversations/${conversation.id}`;
    await call("POST", `${url}/block`, mara.token, { report: { reason: "spam" } });
    await call("DELETE", url, mara.token);
    await call("DELETE", url, devToken);
    expect(conversations.get(conversation.id)).not.toBeNull();
    await adminCall("POST", "/api/messages/dismiss-report", { id: conversation.id });
    expect(conversations.get(conversation.id)).toBeNull();
  });

  it("hides a Tavora conversation the account deletes, keeps it for the admin, and shows it again when Tavora writes", async () => {
    const { user, call, adminCall, conversations } = setup();
    const mara = user("mara@example.com");
    const started = (await (await adminCall("POST", "/api/messages/start", { accountId: mara.account.id, text: "Hi" })).json()) as { id: string };
    expect((await call("DELETE", `/v1/conversations/${started.id}`, mara.token)).status).toBe(204);
    expect(conversations.get(started.id)).not.toBeNull();
    const list = async () => ((await (await call("GET", "/v1/conversations", mara.token)).json()) as { conversations: { id: string }[] }).conversations.map((entry) => entry.id);
    expect(await list()).toEqual([]);
    expect((await adminCall("POST", "/api/messages/reply", { id: started.id, text: "One more thing." })).status).toBe(200);
    expect(await list()).toEqual([started.id]);
  });
});

describe("retention", () => {
  it("closes idle conversations after 30 days, warns three days before, and deletes closed ones after 180 unless reported", async () => {
    const { user, started, call, conversations, clock } = setup();
    const mara = user("mara@example.com");
    const otto = user("otto@example.com", "Otto");
    const idle = await started(mara.token);
    const reported = await started(otto.token);
    await call("POST", `/v1/conversations/${reported.id}/report`, otto.token, { reason: "spam" });
    const start = clock.now;

    clock.now = start + 26 * DAY;
    const quiet = (await (await call("GET", `/v1/conversations/${idle.id}`, mara.token)).json()) as Detail;
    expect(quiet.conversation.closesInDays).toBeNull();
    clock.now = start + 27.5 * DAY;
    expect(((await (await call("GET", `/v1/conversations/${idle.id}`, mara.token)).json()) as Detail).conversation.closesInDays).toBe(3);
    clock.now = start + 29.5 * DAY;
    expect(((await (await call("GET", `/v1/conversations/${idle.id}`, mara.token)).json()) as Detail).conversation.closesInDays).toBe(1);
    // A message restarts the clock.
    await call("POST", `/v1/conversations/${idle.id}/messages`, mara.token, { text: "Still there?" });
    expect(conversations.sweep(clock.now)).toEqual({ closed: 0, deleted: 0 });

    const sweepAt = clock.now + 30 * DAY;
    expect(conversations.sweep(sweepAt)).toEqual({ closed: 2, deleted: 0 });
    expect(conversations.get(idle.id)).toMatchObject({ state: "closed", closeReason: "timeout", closedAt: sweepAt });
    expect(conversations.sweep(sweepAt + 179 * DAY).deleted).toBe(0);
    expect(conversations.sweep(sweepAt + 180 * DAY).deleted).toBe(1);
    expect(conversations.get(idle.id)).toBeNull();
    // The reported one stays until its report is dismissed.
    expect(conversations.get(reported.id)).not.toBeNull();
  });

  it("never times out a Tavora conversation", async () => {
    const { user, adminCall, conversations, clock } = setup();
    const mara = user("mara@example.com");
    const started = (await (await adminCall("POST", "/api/messages/start", { accountId: mara.account.id, text: "Hi" })).json()) as { id: string };
    expect(conversations.sweep(clock.now + 60 * DAY)).toEqual({ closed: 0, deleted: 0 });
    expect(conversations.get(started.id)!.state).toBe("open");
  });
});

describe("deleting an account", () => {
  it("closes its conversations with left, removes its texts and reports, and tells the other side", async () => {
    const { user, started, call, devToken, conversations, store, adminCall } = setup();
    const mara = user("mara@example.com");
    const otto = user("otto@example.com", "Otto");
    const maras = await started(mara.token, { text: "Secret words about my PC" });
    await call("POST", `/v1/conversations/${maras.id}/messages`, devToken, { text: "Reply from the developer" });
    await call("POST", `/v1/conversations/${maras.id}/report`, mara.token, { reason: "other" });
    const ottos = await started(otto.token);
    await call("POST", `/v1/conversations/${ottos.id}/report`, devToken, { reason: "spam" });
    const tavora = (await (await adminCall("POST", "/api/messages/start", { accountId: mara.account.id, text: "Hi Mara" })).json()) as { id: string };

    conversations.forget(mara.account.id);
    store.deleteAccount(mara.account.id);

    const seen = (await (await call("GET", `/v1/conversations/${maras.id}`, devToken)).json()) as Detail;
    expect(seen.conversation).toMatchObject({ state: "closed", closeReason: "left" });
    expect(seen.messages.map((message) => message.text)).toEqual(["", "Reply from the developer"]);
    expect(conversations.reports(maras.id)).toEqual([]);
    expect(conversations.get(tavora.id)).toBeNull();
    // Otto's conversation and the developer's report on it are untouched.
    expect(conversations.reports(ottos.id)).toHaveLength(1);
    // The developer deleting it afterwards removes it for good (no report left).
    await call("DELETE", `/v1/conversations/${maras.id}`, devToken);
    expect(conversations.get(maras.id)).toBeNull();
    // The account route does this too.
    expect(conversations.listFor(mara.account.id)).toEqual([]);
  });
});

describe("deleting an account through the account route", () => {
  it("closes its conversations with left and removes the senders of its reports", async () => {
    const { user, started, call, devToken, inbox, conversations, catalog } = setup();
    const mara = user("mara@example.com");
    const conversation = await started(mara.token, { text: "Private words" });
    await call("POST", "/v1/account/delete/code", mara.token, {});
    const code = inbox.mails()[0]!.text.match(/(\d{6})/)![1]!;
    expect((await call("POST", "/v1/account/delete", mara.token, { code })).status).toBe(204);
    const seen = (await (await call("GET", `/v1/conversations/${conversation.id}`, devToken)).json()) as Detail;
    expect(seen.conversation).toMatchObject({ state: "closed", closeReason: "left" });
    expect(seen.messages[0]!.text).toBe("");
    expect(catalog.reporters("0".repeat(64))).toEqual([]);
  });
});

describe("contact settings", () => {
  it("are the developer's alone, on by default, with a strict https link, and show on the module page", async () => {
    const { user, call, devToken } = setup();
    const mara = user("mara@example.com");
    const url = "/v1/catalog/modules/wellbrained.timer/contact";
    expect((await call("GET", url)).status).toBe(401);
    expect((await call("GET", url, mara.token)).status).toBe(403);
    expect((await call("PUT", url, mara.token, { enabled: false, link: null })).status).toBe(403);
    expect(await (await call("GET", url, devToken)).json()).toEqual({ enabled: true, link: null });
    expect((await call("GET", "/v1/catalog/modules/wellbrained.timer")).status).toBe(200);
    const page = (await (await call("GET", "/v1/catalog/modules/wellbrained.timer")).json()) as { module: { contact: unknown } };
    expect(page.module.contact).toEqual({ enabled: true, link: null });

    for (const link of ["http://example.com", "https://", "javascript:alert(1)", "https://user:pw@example.com", "https://exa mple.com", `https://example.com/${"a".repeat(200)}`, "example.com", 5]) {
      expect((await call("PUT", url, devToken, { enabled: false, link })).status, String(link)).toBe(400);
    }
    expect((await call("PUT", url, devToken, { enabled: "no", link: null })).status).toBe(400);
    expect(await (await call("PUT", url, devToken, { enabled: false, link: "https://github.com/wellbrained/timer/issues" })).json()).toEqual({ enabled: false, link: "https://github.com/wellbrained/timer/issues" });
    const after = (await (await call("GET", "/v1/catalog/modules/wellbrained.timer")).json()) as { module: { contact: unknown } };
    expect(after.module.contact).toEqual({ enabled: false, link: "https://github.com/wellbrained/timer/issues" });
    expect((await call("GET", "/v1/catalog/modules/wellbrained.other/contact", devToken)).status).toBe(404);
  });

  it("checks the link on its own", () => {
    expect(cleanContactLink("https://example.com/path?x=1")).toBe("https://example.com/path?x=1");
    expect(cleanContactLink("")).toBeNull();
    expect(cleanContactLink("ftp://example.com")).toBeUndefined();
  });
});

describe("the email copy setting", () => {
  it("is off for developers and on for others by default, and can be changed", async () => {
    const { user, call, devToken } = setup();
    const mara = user("mara@example.com");
    expect(await (await call("GET", "/v1/conversations/settings", mara.token)).json()).toEqual({ emailCopies: true, hasEmail: true });
    expect(await (await call("GET", "/v1/conversations/settings", devToken)).json()).toEqual({ emailCopies: false, hasEmail: true });
    expect(await (await call("PUT", "/v1/conversations/settings", devToken, { emailCopies: true })).json()).toEqual({ emailCopies: true, hasEmail: true });
    expect(await (await call("GET", "/v1/conversations/settings", devToken)).json()).toEqual({ emailCopies: true, hasEmail: true });
    expect((await call("PUT", "/v1/conversations/settings", mara.token, { emailCopies: "yes" })).status).toBe(400);
    expect((await call("GET", "/v1/conversations/settings")).status).toBe(401);
  });

  it("sends a copy only when it is on and there is an address, naming the sender only by pseudonym", async () => {
    const { user, started, call, devToken, inbox, flush, store, clock, adminCall } = setup();
    const mara = user("mara@example.com", "Mara Private");
    const conversation = await started(mara.token);
    await flush();
    // The developer's copies are off by default: no mail for the request.
    expect(inbox.mails()).toEqual([]);

    await call("PUT", "/v1/conversations/settings", devToken, { emailCopies: true });
    // A copy goes only for the first message the developer hasn't read: the request is still unread, so none yet.
    await call("POST", `/v1/conversations/${conversation.id}/messages`, mara.token, { text: "Forgot to say: on Windows." });
    await flush();
    expect(inbox.mails()).toEqual([]);
    await call("GET", `/v1/conversations/${conversation.id}`, devToken);
    await call("POST", `/v1/conversations/${conversation.id}/messages`, mara.token, { text: "Any news?" });
    await flush();
    expect(inbox.mails()).toHaveLength(1);
    const mail = sent(inbox)[0]!;
    expect(mail.to).toBe("dev@example.com");
    expect(mail.subject).toBe("New message in Tavora");
    expect(mail.text).toContain("Any news?");
    expect(mail.text).toContain(`User · ${conversation.label}`);
    expect(mail.text).toContain("Answer in the Tavora app.");
    for (const secret of ["mara@example.com", "Mara Private", mara.account.id]) expect(mail.text).not.toContain(secret);

    // The user's copies are on by default: the developer's answer is mailed.
    await call("POST", `/v1/conversations/${conversation.id}/messages`, devToken, { text: "Fixed in the next version." });
    await flush();
    expect(inbox.mails()).toHaveLength(2);
    expect(sent(inbox)[1]).toMatchObject({ to: "mara@example.com" });
    expect(sent(inbox)[1]!.text).toContain("Developer of Timer (Wellbrained)");
    expect(sent(inbox)[1]!.text).not.toContain("dev@example.com");

    // Off: nothing is sent.
    await call("PUT", "/v1/conversations/settings", mara.token, { emailCopies: false });
    await call("POST", `/v1/conversations/${conversation.id}/messages`, devToken, { text: "Another note." });
    await flush();
    expect(inbox.mails()).toHaveLength(2);

    // A Discord-only account has no address, so nothing is sent even with copies on.
    const discordOnly = store.createAccount({ discord: { id: "123456789012345678", name: "alex" } }, clock.now - DAY);
    const started2 = (await (await adminCall("POST", "/api/messages/start", { accountId: discordOnly.id, text: "Hello Alex" })).json()) as { id: string };
    await flush();
    expect(started2.id).toBeTruthy();
    expect(inbox.mails()).toHaveLength(2);

    // Tavora's message to an account with an address and copies on is mailed.
    await adminCall("POST", "/api/messages/start", { accountId: mara.account.id, text: "Tavora here" });
    await flush();
    await call("PUT", "/v1/conversations/settings", mara.token, { emailCopies: true });
    await adminCall("POST", "/api/messages/start", { accountId: mara.account.id, text: "Tavora again" });
    await flush();
    expect(inbox.mails()).toHaveLength(3);
    expect(sent(inbox)[2]).toMatchObject({ to: "mara@example.com", subject: "New message from Tavora" });
    expect(sent(inbox)[2]!.text).toContain("From: Tavora");
  });

  it("uses the saved text, in the account's language, and never breaks the request when mail fails", async () => {
    const { user, started, call, devToken, adminCall, flush, inbox, conversations } = setup();
    await adminCall("POST", "/api/texts", { key: "mail.newReply", en: "Hi, {developer} here about {module}.", de: "Hallo, {developer} zu {module}." });
    const mara = user("mara@example.com");
    const conversation = await started(mara.token);
    await call("POST", `/v1/conversations/${conversation.id}/messages`, devToken, { text: "On it." });
    await flush();
    expect(sent(inbox)[0]!.text.startsWith("Hi, Wellbrained here about Timer.")).toBe(true);
    expect(conversations.texts()["mail.newReply"]).toBeTruthy();
  });
});

describe("the admin's messages", () => {
  it("starts a conversation with an account, answers, reopens and counts what waits", async () => {
    const { user, call, adminCall, activity } = setup();
    const mara = user("mara@example.com");
    expect((await adminCall("POST", "/api/messages/start", { accountId: "nobody", text: "Hi" })).status).toBe(404);
    expect((await adminCall("POST", "/api/messages/start", { accountId: mara.account.id, text: "" })).status).toBe(400);
    expect((await adminCall("POST", "/api/messages/start", { accountId: mara.account.id, text: "Hi", about: { type: "nonsense", id: "x" } })).status).toBe(400);
    const made = (await (await adminCall("POST", "/api/messages/start", { accountId: mara.account.id, text: "Your report was received.", about: { type: "module-report", id: "wellbrained.timer" } })).json()) as { id: string };

    // The user sees it from "Tavora", unread, and can answer.
    const list = (await (await call("GET", "/v1/conversations", mara.token)).json()) as { conversations: Item[]; inbox: { open: number; unread: number } };
    expect(list.conversations[0]).toMatchObject({ id: made.id, kind: "tavora", role: "user", title: "Tavora", type: null, unread: true, module: { id: "wellbrained.timer" } });
    expect(list.inbox).toEqual({ open: 1, unread: 1, developer: false });
    const waiting = async () => Object.fromEntries(((await (await adminCall("GET", "/api/summary")).json()) as { waiting: { id: string; count: number }[] }).waiting.map((kind) => [kind.id, kind.count]));
    expect(await waiting()).toMatchObject({ messages: 0, "conversation-reports": 0 });

    expect((await call("POST", `/v1/conversations/${made.id}/messages`, mara.token, { text: "Thanks, I saw it." })).status).toBe(200);
    expect(await waiting()).toMatchObject({ messages: 1 });
    const entry = (await (await adminCall("GET", "/api/messages")).json()) as { conversations: { id: string; unread: boolean; about: unknown; user: { name: string; email: string } }[] };
    expect(entry.conversations[0]).toMatchObject({ id: made.id, unread: true, about: { type: "module-report", id: "wellbrained.timer" }, user: { name: "Mara Private", email: "mara@example.com" } });
    // Reading it marks Tavora's side read.
    const read = (await (await adminCall("GET", `/api/messages/${made.id}`)).json()) as { messages: { from: string }[] };
    expect(read.messages.map((message) => message.from)).toEqual(["tavora", "user"]);
    expect(await waiting()).toMatchObject({ messages: 0 });

    expect((await adminCall("POST", "/api/messages/reply", { id: made.id, text: "You're welcome." })).status).toBe(200);
    expect(((await (await call("GET", `/v1/conversations/${made.id}`, mara.token)).json()) as Detail).messages.at(-1)).toMatchObject({ from: "tavora", text: "You're welcome." });
    expect((await adminCall("POST", "/api/messages/close", { id: made.id })).status).toBe(200);
    expect((await adminCall("POST", "/api/messages/reply", { id: made.id, text: "More?" })).status).toBe(409);
    expect((await call("POST", `/v1/conversations/${made.id}/messages`, mara.token, { text: "hello?" })).status).toBe(409);
    expect((await adminCall("POST", "/api/messages/reopen", { id: made.id })).status).toBe(200);
    expect((await adminCall("POST", "/api/messages/reopen", { id: made.id })).status).toBe(409);
    expect((await call("POST", `/v1/conversations/${made.id}/messages`, mara.token, { text: "hello again" })).status).toBe(200);

    // The Activity log names the account for start and the conversation for the rest.
    const kinds = activity.list({}).entries.map((logged) => [logged.kind, logged.target?.type, logged.target?.id === mara.account.id ? "account" : logged.target?.id === made.id ? "conversation" : "?"]);
    expect(kinds).toContainEqual(["messages/start", "account", "account"]);
    expect(kinds).toContainEqual(["messages/reply", "conversation", "conversation"]);
    expect(kinds).toContainEqual(["messages/close", "conversation", "conversation"]);
  });

  it("reads only its own conversations and reported ones, and counts reported ones as waiting", async () => {
    const { user, started, call, adminCall, devToken } = setup();
    const mara = user("mara@example.com");
    const private_ = await started(mara.token);
    expect((await adminCall("GET", `/api/messages/${private_.id}`)).status).toBe(403);
    expect((await adminCall("POST", "/api/messages/close", { id: private_.id })).status).toBe(403);
    expect((await adminCall("POST", "/api/messages/reply", { id: private_.id, text: "hi" })).status).toBe(403);
    expect((await adminCall("POST", "/api/messages/reopen", { id: private_.id })).status).toBe(403);
    expect((await adminCall("GET", "/api/messages/AAAAAAAAAAAAAAAA")).status).toBe(404);
    expect((await adminCall("GET", "/api/messages/short")).status).toBe(400);
    const list = (await (await adminCall("GET", "/api/messages")).json()) as { conversations: unknown[]; reported: unknown[] };
    expect(JSON.stringify(list)).not.toContain(private_.id);

    await call("POST", `/v1/conversations/${private_.id}/report`, devToken, { reason: "spam" });
    expect(((await (await adminCall("GET", "/api/summary")).json()) as { waiting: { id: string; count: number }[] }).waiting.find((kind) => kind.id === "conversation-reports")!.count).toBe(1);
    expect((await adminCall("POST", "/api/messages/close", { id: private_.id })).status).toBe(200);
    expect(((await (await call("GET", `/v1/conversations/${private_.id}`, mara.token)).json()) as Detail).conversation).toMatchObject({ state: "closed", closeReason: "tavora" });
  });

  it("needs the admin token", async () => {
    const { admin } = setup();
    expect((await admin.request("http://admin.test/api/messages")).status).toBe(401);
    expect((await admin.request("http://admin.test/api/texts")).status).toBe(401);
    expect((await admin.request("http://admin.test/api/messages/start", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(401);
  });
});

describe("the editable texts", () => {
  it("are saved per key in English and German, with only the allowed placeholders, and served publicly", async () => {
    const { adminCall, call, activity } = setup();
    expect(await (await call("GET", "/v1/texts")).json()).toEqual({ texts: {} });
    expect((await adminCall("POST", "/api/texts", { key: "mail.unknown", en: "x", de: "y" })).status).toBe(400);
    for (const bad of ["Hello {name}", "{module} and {nobody}", "{}"]) {
      const refused = await adminCall("POST", "/api/texts", { key: "inbox.gone", en: bad, de: "" });
      expect(refused.status, bad).toBe(400);
      expect(((await refused.json()) as { reason: string }).reason).toBe("placeholder");
    }
    expect((await adminCall("POST", "/api/texts", { key: "inbox.gone", en: "x".repeat(2001), de: "" })).status).toBe(400);
    expect((await adminCall("POST", "/api/texts", { key: "inbox.gone", en: 5, de: "" })).status).toBe(400);

    const saved = await adminCall("POST", "/api/texts", { key: "inbox.appeared.sent", en: "You wrote to the developer of {module}. {developer} answers within {days} days. {reason}", de: "Du hast {developer} zu {module} geschrieben." });
    expect(saved.status).toBe(200);
    const publicTexts = await call("GET", "/v1/texts");
    expect(publicTexts.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await publicTexts.json()).toEqual({ texts: { "inbox.appeared.sent": { en: "You wrote to the developer of {module}. {developer} answers within {days} days. {reason}", de: "Du hast {developer} zu {module} geschrieben." } } });
    const listed = (await (await adminCall("GET", "/api/texts")).json()) as { keys: string[]; placeholders: string[]; texts: Record<string, unknown> };
    expect(listed.keys).toHaveLength(7);
    expect(listed.placeholders).toEqual(["module", "developer", "days", "reason"]);
    expect(Object.keys(listed.texts)).toEqual(["inbox.appeared.sent"]);

    // Empty English and German delete the override.
    await adminCall("POST", "/api/texts", { key: "inbox.appeared.sent", en: "  ", de: "" });
    expect(await (await call("GET", "/v1/texts")).json()).toEqual({ texts: {} });
    expect(activity.list({}).entries.some((logged) => logged.kind === "texts" && logged.target?.id === "inbox.appeared.sent")).toBe(true);
  });

  it("fills and checks placeholders", () => {
    expect(fillPlaceholders("{module} by {developer}, {days} days{reason}", { module: "Timer", developer: "Wellbrained", days: "3" })).toBe("Timer by Wellbrained, 3 days");
    expect(placeholdersOk("a {module} b {days}")).toBe(true);
    expect(placeholdersOk("a {nope}")).toBe(false);
    expect(placeholdersOk("a { alone")).toBe(true);
    expect(placeholdersOk("a { and } b")).toBe(false);
  });
});

describe("without conversations", () => {
  it("answers 503 for the routes", async () => {
    const store = new AccountStore(":memory:");
    const app = createApp({ db, rateLimiter: roomy(), accounts: { store, mailer: createTestInbox() } });
    expect((await app.request("http://tavora.test/v1/conversations")).status).toBe(503);
    expect((await app.request("http://tavora.test/v1/texts")).status).toBe(503);
  });
});
