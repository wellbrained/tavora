import { createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { publishSignature, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { ActivityLog } from "./activity-log.ts";
import { createAdminApp } from "./admin-app.ts";
import { createApp } from "./app.ts";
import { CatalogStore } from "./catalog.ts";
import { CopyStore } from "./cloud-copy.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createHostedStore } from "./hosted-store.ts";
import { IconState } from "./icon-state.ts";
import { DiscordError, type DiscordClient } from "./discord.ts";
import { DatabaseSync } from "node:sqlite";
import { createTestInbox } from "./mail.ts";
import { encodePng } from "./png.ts";
import { keyFingerprint } from "./publishers.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { ReviewStore } from "./reviews.ts";
import { createSubmissions } from "./submissions.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });
const rawKey = (key: KeyObject) => createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12);
const TOKEN = "t0ken-".repeat(5);
const PICTURE = Buffer.from(encodePng(256, 256, Uint8Array.from({ length: 256 * 256 * 4 }, (_, i) => (i % 4 === 3 ? 255 : i % 251))));
const ALEX = { id: "123456789012345678", name: "alex" };
const VERIFIER = "v".repeat(43);
const SECRET_WORDS = ["token_hash", "code_hash", "tvp_", "hash"];

function moduleZip(key: KeyObject, id = "wellbrained.timer", version = "1.0.0"): Buffer {
  const manifest = { id, name: "Timer", version, apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } };
  const files: ZipFile[] = [{ name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) }, { name: "index.html", data: Buffer.from("<p>timer</p>") }];
  return writeZip([...files, signFiles(files, key)]);
}

function setup(ownerEmail?: string) {
  const store = new AccountStore(":memory:");
  const reviews = new ReviewStore(":memory:");
  const copies = new CopyStore(":memory:");
  const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-accounts-admin-")));
  const inbox = createTestInbox();
  const clock = { now: Date.parse("2026-10-26T12:00:00Z") };
  const discord: DiscordClient = {
    identify: async (code) => {
      if (code !== "codealexalex") throw new DiscordError("discord-refused");
      return ALEX;
    },
  };
  const app = createApp({
    db,
    catalog,
    rateLimiter: roomy(),
    reviewRateLimiter: roomy(),
    publishRateLimiter: roomy(),
    accounts: { store, mailer: inbox, reviews, copies, codeRateLimiter: roomy(), verifyRateLimiter: roomy(), prefixRateLimiter: roomy(), now: () => clock.now, discord },
  });
  const state = new IconState(":memory:");
  const hosted = createHostedStore({ list: () => [], file: () => null }, state);
  const submissions = createSubmissions({ state, store: hosted, gameName: () => null, gamesNamed: () => [] });
  const activity = new ActivityLog(":memory:");
  const admin = createAdminApp({
    token: TOKEN,
    submissions,
    state,
    store: hosted,
    catalog,
    accounts: store,
    reviews,
    copies,
    moderation: { mailer: inbox, now: () => clock.now },
    ...(ownerEmail ? { ownerEmail } : {}),
    activity,
  });
  const adminCall = (method: string, url: string, body?: unknown, token: string | null = TOKEN) =>
    admin.request(`http://admin.test${url}`, {
      method,
      headers: { ...(token ? { "X-Admin-Token": token } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const get = async (url: string) => {
    const response = await adminCall("GET", url);
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  const post = async (url: string, body: unknown) => {
    const response = await adminCall("POST", url, body);
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  const account = (url: string, method: string, body?: unknown, token?: string) =>
    app.request(`http://tavora.test/v1/account${url}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const catalogCall = (method: string, url: string, token?: string, body?: unknown) =>
    app.request(`http://tavora.test/v1/catalog${url}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  /** A developer with a key, a prefix and a listed module, signed in on a PC. */
  const developerKey = generateKeyPairSync("ed25519").privateKey;
  catalog.add(moduleZip(developerKey));
  const developer = store.createAccount({ email: "dev@example.com" }, clock.now - 5 * 86_400_000);
  store.linkKey(developer.id, keyFingerprint(rawKey(developerKey)), rawKey(developerKey).toString("base64"), clock.now - 4 * 86_400_000);
  store.setDeveloperName(developer.id, "Well Brained", clock.now - 3 * 86_400_000);
  store.reservePrefix(developer.id, "wellbrained", clock.now - 3 * 86_400_000);
  store.setProfile(developer.id, { name: "Dev Person", initials: "DP", picture: PICTURE, updatedAt: clock.now });
  const devSession = store.createSession(developer.id, "windows", clock.now - 3_600_000, "Dev PC");
  const publishToken = store.createPublishToken(developer.id, "GitHub Actions", clock.now)!.token;
  const publish = (token: string) => {
    const zip = moduleZip(developerKey, "wellbrained.timer", "1.1.0");
    return app.request("http://tavora.test/v1/catalog/publish", {
      method: "POST",
      headers: { "content-type": "application/zip", "x-tavora-signature": publishSignature(developerKey, zip), authorization: `Bearer ${token}` },
      body: new Uint8Array(zip),
    });
  };
  const user = (email: string, name = "Mara") => {
    const created = store.createAccount({ email }, clock.now - 86_400_000); // a day old, old enough to rate
    if (name) store.setProfile(created.id, { name, initials: name.slice(0, 2).toUpperCase(), picture: null, updatedAt: clock.now });
    return { account: created, token: store.createSession(created.id, "linux", clock.now, "Mara's PC").token };
  };
  const signIn = async (email: string) => {
    await account("/code", "POST", { email });
    const code = /\n {4}(\d{6})\n/.exec(inbox.mails().at(-1)?.text ?? "")?.[1] ?? "";
    return account("/verify", "POST", { email, code, os: "windows", create: false });
  };
  return { activity, store, reviews, copies, catalog, inbox, clock, adminCall, get, post, account, catalogCall, developer, devSession, publishToken, publish, user, signIn };
}

describe("the account list", () => {
  it("needs the admin token", async () => {
    const { adminCall, developer } = setup();
    for (const url of ["/api/accounts/list", `/api/accounts/${developer.id}`, `/api/accounts/${developer.id}/picture.png`]) {
      expect((await adminCall("GET", url, undefined, null)).status).toBe(401);
      expect((await adminCall("GET", url, undefined, "wrong-token-wrong-token-wrong")).status).toBe(401);
    }
    expect((await adminCall("POST", "/api/accounts/suspend", { id: developer.id, reason: "spam" }, null)).status).toBe(401);
    expect((await adminCall("POST", "/api/accounts/unsuspend", { id: developer.id }, null)).status).toBe(401);
  });

  it("keeps the counts endpoint working", async () => {
    const { get } = setup();
    expect((await get("/api/accounts")).body).toMatchObject({ on: true, total: 1 });
  });

  it("lists every account with what the panel shows, and no secret", async () => {
    const { get, user, developer } = setup();
    user("mara@example.com");
    const { status, body } = await get("/api/accounts/list");
    expect(status).toBe(200);
    expect(body).toMatchObject({ total: 2, counts: { developers: 1, banned: 0, suspended: 0 } });
    const dev = body.accounts.find((row: { id: string }) => row.id === developer.id);
    expect(dev).toEqual({
      id: developer.id,
      email: "dev@example.com",
      discord: null,
      profileName: "Dev Person",
      initials: "DP",
      hasPicture: true,
      developer: "Well Brained",
      createdAt: "2026-10-21T12:00:00.000Z",
      lastActiveAt: "2026-10-26T11:00:00.000Z",
      devices: 1,
      banned: false,
      suspended: false,
      owner: false,
      state: "active",
    });
    const text = JSON.stringify(body);
    for (const word of SECRET_WORDS) expect(text).not.toContain(word);
  });

  it("searches email, Discord name, profile, developer name, id, key, prefix and module id; and filters", async () => {
    const { get, user, developer, store, post } = setup();
    const mara = user("mara@example.com");
    store.setDiscord(mara.account.id, ALEX);
    const fingerprint = store.keys(developer.id)[0]!.fingerprint;
    const find = async (q: string, filter = "all") => ((await get(`/api/accounts/list?q=${encodeURIComponent(q)}&filter=${filter}`)).body.accounts as { id: string }[]).map((row) => row.id);
    expect(await find("MARA@")).toEqual([mara.account.id]);
    expect(await find("alex")).toEqual([mara.account.id]);
    expect(await find("dev person")).toEqual([developer.id]);
    expect(await find("well brained")).toEqual([developer.id]);
    expect(await find(developer.id)).toEqual([developer.id]);
    expect(await find(fingerprint.slice(0, 10))).toEqual([developer.id]);
    expect(await find("wellbrained")).toEqual([developer.id]);
    expect(await find("wellbrained.timer")).toEqual([developer.id]);
    expect(await find("nobody-has-this")).toEqual([]);
    expect(await find("", "developers")).toEqual([developer.id]);
    expect(await find("", "suspended")).toEqual([]);
    expect((await post("/api/accounts/suspend", { id: mara.account.id, reason: "spam" })).status).toBe(200);
    expect(await find("", "suspended")).toEqual([mara.account.id]);
    expect(await find("", "banned")).toEqual([]);
    store.ban(developer.id, "unsafe", null, [], Date.now());
    expect(await find("", "banned")).toEqual([developer.id]);
    expect((await get("/api/accounts/list?filter=nope")).status).toBe(400);
  });
});

describe("one account's details", () => {
  it("shows everything the service keeps, and no secret", async () => {
    const { get, developer, store, copies, catalogCall, user, clock } = setup();
    const mara = user("mara@example.com");
    store.setDiscord(developer.id, ALEX);
    store.putVault(developer.id, 0, new Uint8Array([1, 2, 3, 4]), clock.now);
    copies.swap(developer.id, 0, new Uint8Array(12), [], clock.now);
    await catalogCall("PUT", "/modules/wellbrained.timer/review", mara.token, { stars: 4, text: "Nice.", version: "1.0.0" });
    const { status, body } = await get(`/api/accounts/${developer.id}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: developer.id,
      email: "dev@example.com",
      discord: { name: "alex" },
      lastActiveAt: "2026-10-26T11:00:00.000Z",
      state: "active",
      profile: { name: "Dev Person", initials: "DP", hasPicture: true },
      developer: { name: "Well Brained" },
      prefixes: [{ prefix: "wellbrained" }],
      publishTokens: [{ name: "GitHub Actions", lastUsedAt: null }],
      modules: [{ id: "wellbrained.timer", name: "Timer", listed: true, state: "published", installs: 0, versions: 1 }],
      reviews: { written: 0, hidden: 0 },
      vault: { updatedAt: "2026-10-26T12:00:00.000Z" },
      ban: null,
      suspension: null,
    });
    expect(body.devices).toEqual([{ os: "windows", name: "Dev PC", createdAt: "2026-10-26T11:00:00.000Z", lastUsedAt: "2026-10-26T11:00:00.000Z" }]);
    expect(body.keys).toEqual([{ fingerprint: store.keys(developer.id)[0]!.fingerprint, linkedAt: "2026-10-22T12:00:00.000Z" }]);
    expect(body.cloudCopy).toEqual({ size: 12, updatedAt: "2026-10-26T12:00:00.000Z" });
    const text = JSON.stringify(body);
    for (const word of SECRET_WORDS) expect(text).not.toContain(word);
    expect(text).not.toContain("tvp_");
    // The reviewer's side: reviews written.
    expect((await get(`/api/accounts/${mara.account.id}`)).body).toMatchObject({ reviews: { written: 1, hidden: 0 }, developer: null, profile: { name: "Mara", hasPicture: false } });
  });

  it("serves the picture as a PNG, 404 without one, and 404 for an unknown or odd id", async () => {
    const { adminCall, developer, user, get } = setup();
    const mara = user("mara@example.com");
    const picture = await adminCall("GET", `/api/accounts/${developer.id}/picture.png`);
    expect(picture.status).toBe(200);
    expect(picture.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await picture.arrayBuffer()).equals(PICTURE)).toBe(true);
    expect((await adminCall("GET", `/api/accounts/${mara.account.id}/picture.png`)).status).toBe(404);
    expect((await get("/api/accounts/nobody")).status).toBe(404);
    expect((await get("/api/accounts/..%2F..%2Fx")).status).toBe(404);
    expect((await adminCall("GET", "/api/accounts/nobody/picture.png")).status).toBe(404);
  });

  it("shows the ban and the suspension with reasons and dates", async () => {
    const { get, post, developer, store } = setup();
    store.ban(developer.id, "spam", "Copies.", ["wellbrained.timer"], Date.parse("2026-10-25T00:00:00Z"));
    await post("/api/accounts/suspend", { id: developer.id, reason: "hateful", note: "Rude." });
    const { body } = await get(`/api/accounts/${developer.id}`);
    expect(body).toMatchObject({
      state: "suspended",
      ban: { reason: "spam", note: "Copies.", bannedAt: "2026-10-25T00:00:00.000Z", modules: 1 },
      suspension: { reason: "hateful", note: "Rude.", suspendedAt: "2026-10-26T12:00:00.000Z" },
      lastActiveAt: "2026-10-26T11:00:00.000Z",
      devices: [],
    });
  });
});

describe("Suspend account", () => {
  it("signs out every device at once, so an existing token is refused everywhere", async () => {
    const { post, developer, devSession, account, catalogCall, store } = setup();
    const second = store.createSession(developer.id, "linux", Date.parse("2026-10-26T12:00:00Z"), "Laptop").token;
    expect((await account("", "GET", undefined, devSession.token)).status).toBe(200);
    expect(await post("/api/accounts/suspend", { id: developer.id, reason: "unsafe", note: "Steals logins." })).toMatchObject({ status: 200, body: { ok: true, signedOut: 2, mailed: true } });
    for (const token of [devSession.token, second]) {
      expect((await account("", "GET", undefined, token)).status).toBe(401);
      expect((await account("/developer", "GET", undefined, token)).status).toBe(401);
      expect((await account("/delete/code", "POST", {}, token)).status).toBe(401);
      expect((await catalogCall("GET", "/modules/wellbrained.timer/review", token)).status).toBe(401);
    }
    expect(store.devices(developer.id)).toEqual([]);
    expect(store.isSuspended(developer.id)).toBe(true);
  });

  it("refuses sign-in by email once the code is right, and creates no session", async () => {
    const { post, developer, signIn, store, inbox, account } = setup();
    await post("/api/accounts/suspend", { id: developer.id, reason: "spam" });
    inbox.clear();
    const refused = await signIn("dev@example.com");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ reason: "suspended" });
    expect(store.devices(developer.id)).toEqual([]);
    // A wrong code still gets the plain wrong-code answer: suspension is only said after the right code.
    const wrong = await account("/verify", "POST", { email: "dev@example.com", code: "000000", os: "windows" });
    expect(await wrong.json()).toMatchObject({ reason: "wrong-code" });
  });

  it("refuses sign-in with Discord, for a known login and for a new account's ticket", async () => {
    const { post, user, account, store } = setup();
    const mara = user("mara@example.com");
    store.setDiscord(mara.account.id, ALEX);
    await post("/api/accounts/suspend", { id: mara.account.id, reason: "adult" });
    const refused = await account("/discord/sign-in", "POST", { code: "codealexalex", verifier: VERIFIER, os: "windows" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ reason: "suspended" });
    expect(store.devices(mara.account.id)).toEqual([]);
    // A ticket held before the suspension cannot create or enter the account either.
    const ticket = store.holdDiscord(ALEX, Date.parse("2026-10-26T12:00:00Z"));
    const viaTicket = await account("/discord/create", "POST", { ticket, os: "windows" });
    expect(viaTicket.status).toBe(403);
    expect(await viaTicket.json()).toMatchObject({ reason: "suspended" });
    expect(store.devices(mara.account.id)).toEqual([]);
  });

  it("stops publishing with a sign-in and with a publish token, and starts again after Unsuspend", async () => {
    const { post, developer, publish, publishToken, store, catalog } = setup();
    const signedIn = store.createSession(developer.id, "windows", Date.parse("2026-10-26T12:00:00Z")).token;
    expect((await publish(signedIn)).status).not.toBe(403);
    await post("/api/accounts/suspend", { id: developer.id, reason: "spam" });
    for (const token of [signedIn, publishToken]) {
      // Both are dead: the sign-in is deleted, and the token of a suspended account is not accepted at all.
      expect((await publish(token)).status).toBe(401);
    }
    // A fresh sign-in token created behind the service's back is still refused (the second lock).
    const sneaked = store.createSession(developer.id, "windows", Date.parse("2026-10-26T12:00:00Z")).token;
    expect(store.sessionByToken(sneaked, Date.parse("2026-10-26T12:00:00Z"))).toBeNull();
    expect((await publish(sneaked)).status).toBe(401);
    expect(catalog.waitingVersions().length + catalog.index().length).toBeGreaterThan(0);
    await post("/api/accounts/unsuspend", { id: developer.id });
    expect((await publish(publishToken)).status).not.toBe(403);
  });

  it("refuses to approve a waiting version of a suspended developer", async () => {
    const { post, developer, publish, publishToken, catalog } = setup();
    await publish(publishToken);
    const waiting = catalog.waitingVersions()[0]!;
    expect(waiting.accountId).toBe(developer.id);
    await post("/api/accounts/suspend", { id: developer.id, reason: "spam" });
    const refused = await post("/api/moderation/approve", { sha256: waiting.sha256 });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain("suspended");
  });

  it("hides the account's reviews and replies, keeps their stars, and shows them again on Unsuspend", async () => {
    const { post, user, catalogCall, reviews, clock } = setup();
    const mara = user("mara@example.com");
    const other = user("other@example.com", "Otto");
    await catalogCall("PUT", "/modules/wellbrained.timer/review", mara.token, { stars: 2, text: "Meh.", version: "1.0.0" });
    await catalogCall("PUT", "/modules/wellbrained.timer/review", other.token, { stars: 5, text: "Great!", version: "1.0.0" });
    const own = reviews.own(mara.account.id, "wellbrained.timer")!;
    const hiddenByPerson = reviews.own(other.account.id, "wellbrained.timer")!;
    reviews.setReply(own.id, "Thanks.", clock.now);
    reviews.setHidden(hiddenByPerson.id, true);
    reviews.report(own.id, other.account.id, clock.now);
    expect(reviews.reports()).toHaveLength(1);
    const listed = async () => ((await (await catalogCall("GET", "/modules/wellbrained.timer/reviews")).json()) as { summary: { count: number; average: number }; reviews: { text: string; reply: unknown }[] });

    const before = await listed();
    expect(before.reviews.map((review) => review.text)).toEqual(["Meh."]);
    expect(before.reviews[0]!.reply).toMatchObject({ text: "Thanks." });

    expect(await post("/api/accounts/suspend", { id: mara.account.id, reason: "hateful" })).toMatchObject({ body: { hiddenReviews: 1 } });
    const during = await listed();
    expect(during.reviews).toEqual([]);
    // The stars still count, as for any hidden review.
    expect(during.summary).toMatchObject({ count: 2, average: 3.5 });
    expect(reviews.reports()).toEqual([]);
    expect(reviews.own(mara.account.id, "wellbrained.timer")).toMatchObject({ hidden: true, text: "Meh.", reply: { text: "Thanks." } });

    expect(await post("/api/accounts/unsuspend", { id: mara.account.id })).toMatchObject({ status: 200, body: { ok: true, shownReviews: 1 } });
    const after = await listed();
    expect(after.reviews.map((review) => review.text)).toEqual(["Meh."]);
    expect(after.reviews[0]!.reply).toMatchObject({ text: "Thanks." });
    // A review a person hid on its own stays hidden.
    expect(reviews.review(hiddenByPerson.id)!.hidden).toBe(true);
  });

  it("emails the reason in the person's language (English by default, German when their last version used it)", async () => {
    const { post, user, inbox } = setup();
    const mara = user("mara@example.com");
    expect((await post("/api/accounts/suspend", { id: mara.account.id, reason: "spam", note: "Same text everywhere." })).body.mailed).toBe(true);
    const mail = inbox.mails().at(-1)!;
    expect(mail).toMatchObject({ to: "mara@example.com", subject: "Your Tavora account is suspended" });
    expect(mail.text).toContain("Reason: Spam or copy");
    expect(mail.text).toContain("Same text everywhere.");
    expect(mail.text).not.toMatch(/token|hash/i);
  });

  it("emails in German for a developer whose last version came in German", async () => {
    const { post, developer, inbox, catalog } = setup();
    (catalog as unknown as { languageOf: (id: string) => string }).languageOf = () => "de";
    await post("/api/accounts/suspend", { id: developer.id, reason: "other" });
    const mail = inbox.mails().at(-1)!;
    expect(mail.subject).toBe("Dein Tavora-Konto ist gesperrt");
    expect(mail.text).toContain("Grund: Etwas anderes");
  });

  it("does not email a Discord-only account, and still suspends it", async () => {
    const { post, store, inbox } = setup();
    const discordOnly = store.createAccount({ discord: ALEX }, Date.now());
    inbox.clear();
    expect(await post("/api/accounts/suspend", { id: discordOnly.id, reason: "spam" })).toMatchObject({ status: 200, body: { ok: true, mailed: false } });
    expect(inbox.mails()).toEqual([]);
  });

  it("refuses bad requests, an unknown account and a second suspension", async () => {
    const { post, developer } = setup();
    expect((await post("/api/accounts/suspend", { id: developer.id, reason: "broken" })).status).toBe(400);
    expect((await post("/api/accounts/suspend", { id: developer.id })).status).toBe(400);
    expect((await post("/api/accounts/suspend", { reason: "spam" })).status).toBe(400);
    expect((await post("/api/accounts/suspend", { id: developer.id, reason: "spam", note: "x".repeat(501) })).status).toBe(400);
    expect((await post("/api/accounts/suspend", { id: developer.id, reason: "spam", note: 5 })).status).toBe(400);
    expect((await post("/api/accounts/suspend", { id: "nobody", reason: "spam" })).status).toBe(404);
    expect((await post("/api/accounts/suspend", { id: developer.id, reason: "spam" })).status).toBe(200);
    expect((await post("/api/accounts/unsuspend", {})).status).toBe(400);
    expect((await post("/api/accounts/unsuspend", { id: "nobody" })).status).toBe(404);
  });
});

describe("everything one person wrote", () => {
  it("lists the account's ratings, hides every text at once (stars stay), and removes them all", async () => {
    const { get, post, user, catalogCall, reviews, activity } = setup();
    const mara = user("mara@example.com");
    const other = user("other@example.com", "Otto");
    await catalogCall("PUT", "/modules/wellbrained.timer/review", mara.token, { stars: 1, text: "Awful.", version: "1.0.0" });
    await catalogCall("PUT", "/modules/wellbrained.timer/review", other.token, { stars: 5, text: "Great!", version: "1.0.0" });
    reviews.report(reviews.own(mara.account.id, "wellbrained.timer")!.id, other.account.id, Date.now());

    const listed = await get(`/api/accounts/${mara.account.id}/reviews`);
    expect(listed.body.reviews).toEqual([expect.objectContaining({ moduleId: "wellbrained.timer", moduleName: "Timer", stars: 1, text: "Awful.", hidden: false, held: false })]);
    expect((await get("/api/accounts/nobody/reviews")).status).toBe(404);

    expect(await post("/api/accounts/hide-reviews", { id: mara.account.id })).toMatchObject({ status: 200, body: { hiddenReviews: 1 } });
    expect(reviews.reports()).toEqual([]);
    const page = (await (await catalogCall("GET", "/modules/wellbrained.timer/reviews")).json()) as { summary: { count: number }; reviews: { text: string }[] };
    expect(page.reviews.map((review) => review.text)).toEqual(["Great!"]);
    expect(page.summary.count).toBe(2);
    // A person's choice: unsuspending later doesn't bring them back.
    expect(reviews.own(mara.account.id, "wellbrained.timer")).toMatchObject({ hidden: true });

    expect(await post("/api/accounts/remove-reviews", { id: mara.account.id })).toMatchObject({ status: 200, body: { removedReviews: 1 } });
    expect(reviews.summary("wellbrained.timer")?.count).toBe(1);
    expect(activity.list({ kind: "accounts" }).entries.map((entry) => [entry.kind, entry.target?.id])).toEqual([
      ["accounts/remove-reviews", mara.account.id],
      ["accounts/hide-reviews", mara.account.id],
    ]);
  });
});

describe("Unsuspend", () => {
  it("lets the person sign in again with a new sign-in, and the old tokens stay dead", async () => {
    const { post, developer, devSession, account, signIn, store, inbox } = setup();
    await post("/api/accounts/suspend", { id: developer.id, reason: "spam" });
    expect(await post("/api/accounts/unsuspend", { id: developer.id })).toMatchObject({ status: 200, body: { ok: true } });
    expect((await account("", "GET", undefined, devSession.token)).status).toBe(401);
    inbox.clear();
    const answer = await signIn("dev@example.com");
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ status: "signed-in", account: { email: "dev@example.com" } });
    expect(store.devices(developer.id)).toHaveLength(1);
    expect(store.isSuspended(developer.id)).toBe(false);
    // Discord works again too.
    store.setDiscord(developer.id, ALEX);
    expect((await account("/discord/sign-in", "POST", { code: "codealexalex", verifier: VERIFIER, os: "windows" })).status).toBe(200);
    expect((await post("/api/accounts/unsuspend", { id: developer.id })).status).toBe(404);
  });

  it("is kept in the accounts database across a restart", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tavora-suspension-"));
    const file = path.join(dir, "accounts.sqlite");
    const first = new AccountStore(file);
    const account = first.createAccount({ email: "a@example.com" }, 1000);
    first.createSession(account.id, "windows", 2000);
    first.suspend(account.id, "spam", "n", 3000);
    first.close();
    const again = new AccountStore(file);
    expect(again.suspension(account.id)).toEqual({ reason: "spam", note: "n", suspendedAt: 3000, lastActiveAt: 2000 });
    expect(again.devices(account.id)).toEqual([]);
    again.close();
  });
});

describe("a suspended or banned developer and the waiting versions", () => {
  it("can neither list nor withdraw them, with a sign-in or a publish token", async () => {
    const ctx = setup();
    const { post, developer, publish, publishToken, catalog, store } = ctx;
    const signedIn = store.createSession(developer.id, "windows", Date.parse("2026-10-26T12:00:00Z")).token;
    await publish(publishToken);
    const waiting = catalog.waitingVersions()[0]!;
    expect((await ctx.catalogCall("GET", "/waiting", signedIn)).status).toBe(200);

    await post("/api/accounts/suspend", { id: developer.id, reason: "spam" });
    for (const token of [signedIn, publishToken]) {
      expect((await ctx.catalogCall("GET", "/waiting", token)).status).toBe(401);
      expect((await ctx.catalogCall("DELETE", `/waiting/${waiting.sha256}`, token)).status).toBe(401);
    }
    expect(catalog.waitingVersion(waiting.sha256)).not.toBeNull();
    expect(store.publishTokenAccount(publishToken, Date.now())).toBeNull();
    await post("/api/accounts/unsuspend", { id: developer.id });

    // Banned: the token still identifies the account, and the routes say banned.
    store.ban(developer.id, "spam", null, [], Date.now());
    const again = store.createSession(developer.id, "windows", Date.parse("2026-10-26T12:00:00Z")).token;
    for (const token of [again, publishToken]) {
      for (const [method, url] of [["GET", "/waiting"], ["DELETE", `/waiting/${waiting.sha256}`]] as const) {
        const refused = await ctx.catalogCall(method, url, token);
        expect(refused.status).toBe(403);
        expect(await refused.json()).toMatchObject({ reason: "banned" });
      }
    }
    expect(catalog.waitingVersion(waiting.sha256)).not.toBeNull();
  });
});

describe("deleting a suspended account", () => {
  const codeOf = (inbox: ReturnType<typeof setup>["inbox"]) => /\n {4}(\d{6})\n/.exec(inbox.mails().at(-1)!.text)![1]!;

  it("works with a code to its address, never makes a sign-in, and deletes everything", async () => {
    const { post, account, inbox, store, reviews, user, catalogCall } = setup();
    const mara = user("mara@example.com");
    await catalogCall("PUT", "/modules/wellbrained.timer/review", mara.token, { stars: 3, text: "ok", version: "1.0.0" });
    await post("/api/accounts/suspend", { id: mara.account.id, reason: "spam" });
    inbox.clear();
    expect((await account("/delete/suspended/code", "POST", { email: "mara@example.com" })).status).toBe(202);
    const code = codeOf(inbox);
    expect((await account("/delete/suspended", "POST", { email: "mara@example.com", code: code === "000000" ? "000001" : "000000" })).status).toBe(400);
    expect((await account("/delete/suspended", "POST", { email: "mara@example.com", code })).status).toBe(204);
    expect(store.account(mara.account.id)).toBeNull();
    expect(store.isSuspended(mara.account.id)).toBe(false);
    expect(reviews.own(mara.account.id, "wellbrained.timer")).toBeNull();
    expect((await account("/delete/suspended", "POST", { email: "mara@example.com", code })).status).toBe(400);
  });

  it("answers the same for an address that is not suspended or has no account, and sends nothing", async () => {
    const { account, inbox, developer, store } = setup();
    for (const email of ["dev@example.com", "nobody@example.com"]) {
      inbox.clear();
      const answer = await account("/delete/suspended/code", "POST", { email });
      expect(answer.status).toBe(202);
      expect(await answer.json()).toEqual({ status: "sent" });
      expect(inbox.mails()).toEqual([]);
      const verify = await account("/delete/suspended", "POST", { email, code: "123456" });
      expect(verify.status).toBe(400);
      expect(await verify.json()).toMatchObject({ reason: "wrong-code" });
    }
    // A code made the usual way for a signed-in delete does not work here for an account that is not suspended.
    const token = store.createSession(developer.id, "windows", Date.now()).token;
    inbox.clear();
    await account("/delete/code", "POST", {}, token);
    const code = codeOf(inbox);
    expect((await account("/delete/suspended", "POST", { email: "dev@example.com", code })).status).toBe(400);
    expect(store.account(developer.id)).not.toBeNull();
  });

  it("works with a fresh Discord sign-in, and only for a suspended account", async () => {
    const { post, account, store } = setup();
    const discordOnly = store.createAccount({ discord: ALEX }, Date.now());
    const refused = await account("/delete/suspended/discord", "POST", { code: "codealexalex", verifier: VERIFIER });
    expect(refused.status).toBe(400);
    expect(store.account(discordOnly.id)).not.toBeNull();
    await post("/api/accounts/suspend", { id: discordOnly.id, reason: "adult" });
    expect((await account("/delete/suspended/discord", "POST", { code: "codealexalex", verifier: VERIFIER })).status).toBe(204);
    expect(store.account(discordOnly.id)).toBeNull();
  });
});

describe("Suspend and the codes already sent", () => {
  it("deletes a sign-in code waiting for the address, so it can't be used after the suspension", async () => {
    const { post, developer, account, inbox, store } = setup();
    await account("/code", "POST", { email: "dev@example.com" });
    const code = /\n {4}(\d{6})\n/.exec(inbox.mails().at(-1)!.text)![1]!;
    await post("/api/accounts/suspend", { id: developer.id, reason: "spam" });
    const answer = await account("/verify", "POST", { email: "dev@example.com", code, os: "windows" });
    expect(await answer.json()).toMatchObject({ reason: "wrong-code" });
    expect(store.devices(developer.id)).toEqual([]);
  });
});

describe("retrying Suspend and Unsuspend", () => {
  it("finishes hiding the reviews when the account is suspended already, without a second email", async () => {
    const { post, user, catalogCall, reviews, store, inbox } = setup();
    const mara = user("mara@example.com");
    await catalogCall("PUT", "/modules/wellbrained.timer/review", mara.token, { stars: 3, text: "ok", version: "1.0.0" });
    // A first try that died after the account was suspended, before the reviews were hidden.
    store.suspend(mara.account.id, "spam", null, Date.now());
    expect(reviews.own(mara.account.id, "wellbrained.timer")!.hidden).toBe(false);
    inbox.clear();
    expect(await post("/api/accounts/suspend", { id: mara.account.id, reason: "hateful" })).toMatchObject({ status: 200, body: { ok: true, already: true, hiddenReviews: 1, mailed: false } });
    expect(reviews.own(mara.account.id, "wellbrained.timer")!.hidden).toBe(true);
    expect(store.suspension(mara.account.id)!.reason).toBe("spam");
    expect(inbox.mails()).toEqual([]);
  });

  it("finishes showing the reviews when the suspension is lifted already", async () => {
    const { post, user, catalogCall, reviews, store } = setup();
    const mara = user("mara@example.com");
    await catalogCall("PUT", "/modules/wellbrained.timer/review", mara.token, { stars: 3, text: "ok", version: "1.0.0" });
    await post("/api/accounts/suspend", { id: mara.account.id, reason: "spam" });
    store.unsuspend(mara.account.id);
    expect(reviews.own(mara.account.id, "wellbrained.timer")!.hidden).toBe(true);
    expect(await post("/api/accounts/unsuspend", { id: mara.account.id })).toMatchObject({ status: 200, body: { shownReviews: 1 } });
    expect(reviews.own(mara.account.id, "wellbrained.timer")!.hidden).toBe(false);
    expect((await post("/api/accounts/unsuspend", { id: mara.account.id })).status).toBe(404);
  });
});

describe("an old reviews database", () => {
  it("gets the hidden_by_suspend column and keeps its reviews", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "tavora-reviews-old-")), "reviews.sqlite");
    const old = new DatabaseSync(file);
    old.exec(`
      create table reviews (
        id text primary key, account_id text not null, module_id text not null,
        stars integer not null check (stars between 1 and 5), text text, version text not null,
        created_at integer not null, updated_at integer not null, hidden integer not null default 0,
        unique (account_id, module_id)
      );
      create table replies (review_id text primary key references reviews (id) on delete cascade, text text not null, updated_at integer not null);
      create table review_reports (review_id text primary key references reviews (id) on delete cascade, count integer not null, first_at integer not null, last_at integer not null);
      insert into reviews (id, account_id, module_id, stars, text, version, created_at, updated_at, hidden) values ('r1', 'a1', 'x.y', 4, 'fine', '1.0.0', 1, 1, 0), ('r2', 'a1', 'x.z', 2, 'hidden before', '1.0.0', 1, 1, 1);
    `);
    old.close();
    const store = new ReviewStore(file);
    expect(store.review("r1")).toMatchObject({ stars: 4, hidden: false });
    expect(store.hideForSuspension("a1")).toBe(1);
    expect(store.review("r1")!.hidden).toBe(true);
    expect(store.showAfterSuspension("a1")).toBe(1);
    expect(store.review("r1")!.hidden).toBe(false);
    expect(store.review("r2")!.hidden).toBe(true);
    store.close();
    new ReviewStore(file).close();
  });
});

describe("the owner's account", () => {
  it("is marked as the owner, in any case, and can't be suspended", async () => {
    const { get, post, developer, store } = setup("Dev@Example.com");
    expect((await get(`/api/accounts/${developer.id}`)).body.owner).toBe(true);
    const list = await get("/api/accounts/list");
    expect(list.body.accounts.find((row: { id: string }) => row.id === developer.id).owner).toBe(true);
    const refused = await post("/api/accounts/suspend", { id: developer.id, reason: "spam" });
    expect(refused.status).toBe(403);
    expect(store.isSuspended(developer.id)).toBe(false);
  });

  it("is nobody's account without an owner address", async () => {
    const { get, developer } = setup();
    expect((await get(`/api/accounts/${developer.id}`)).body.owner).toBe(false);
  });
});

describe("the activity log and Unpublish", () => {
  it("writes down what the maintainer did, with the reason and note, newest first", async () => {
    const { get, post, developer } = setup();
    await post("/api/accounts/suspend", { id: developer.id, reason: "spam", note: "Many copies." });
    await post("/api/accounts/unsuspend", { id: developer.id });
    const { status, body } = await get("/api/activity");
    expect(status).toBe(200);
    expect(body.hasMore).toBe(false);
    expect(body.entries.map((entry: { kind: string }) => entry.kind)).toEqual(["accounts/unsuspend", "accounts/suspend"]);
    expect(body.entries[1]).toMatchObject({ target: { type: "account", id: developer.id, label: "Dev Person" }, reason: "spam", note: "Many copies." });
    expect((await get("/api/activity?kind=accounts/suspend")).body.entries).toHaveLength(1);
    expect((await get("/api/activity?q=copies")).body.entries).toHaveLength(1);
    expect((await get("/api/activity?q=nothing-like-this")).body.entries).toEqual([]);
    const first = body.entries[0].id as number;
    expect((await get(`/api/activity?before=${first}`)).body.entries.map((entry: { kind: string }) => entry.kind)).toEqual(["accounts/suspend"]);
    expect((await get("/api/activity?limit=1")).body).toMatchObject({ hasMore: true });
  });

  it("keeps nothing of a refused action and needs the admin token", async () => {
    const { get, post, adminCall } = setup();
    expect((await post("/api/catalog/listed", { id: "nobody.here", listed: false })).status).toBe(404);
    expect((await get("/api/activity")).body.entries).toEqual([]);
    expect((await adminCall("GET", "/api/activity", undefined, null)).status).toBe(401);
  });

  it("unpublishes with a reason, tells the developer by email and logs it; publishing needs no reason", async () => {
    const { get, post, inbox, developer } = setup();
    const refused = await post("/api/catalog/listed", { id: "wellbrained.timer", listed: false, reason: "not-a-reason" });
    expect(refused.status).toBe(400);
    const done = await post("/api/catalog/listed", { id: "wellbrained.timer", listed: false, reason: "broken", note: "It crashes on start." });
    expect(done.body).toEqual({ ok: true, mailed: true });
    const mail = inbox.mails().at(-1)!;
    expect(mail.to).toBe("dev@example.com");
    expect(mail.subject).toContain("Timer");
    expect(mail.text).toContain("It crashes on start.");
    expect((await get("/api/accounts/" + developer.id)).body.modules[0].state).toBe("unpublished");
    expect((await post("/api/catalog/listed", { id: "wellbrained.timer", listed: true })).body).toEqual({ ok: true });
    const log = (await get("/api/activity")).body.entries;
    expect(log[1]).toMatchObject({ kind: "catalog/listed", target: { type: "module", id: "wellbrained.timer", label: "Timer" }, reason: "broken", detail: { listed: false, mailed: true } });
  });
});
