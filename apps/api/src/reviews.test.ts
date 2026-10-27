import { createHash, createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createAdminApp } from "./admin-app.ts";
import { createApp } from "./app.ts";
import { CatalogStore } from "./catalog.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createTestInbox } from "./mail.ts";
import { keyFingerprint } from "./publishers.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { cleanReviewText, ReviewStore } from "./reviews.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });
const rawKey = (key: KeyObject) => createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12);
const DAY = 24 * 3_600_000;
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

function moduleZip(key: KeyObject, version = "1.0.0"): Buffer {
  const manifest = { id: "wellbrained.timer", name: "Timer", version, apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } };
  const files: ZipFile[] = [{ name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) }, { name: "index.html", data: Buffer.from("<p>timer</p>") }];
  return writeZip([...files, signFiles(files, key)]);
}

function setup() {
  const store = new AccountStore(":memory:");
  const reviews = new ReviewStore(":memory:");
  const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-catalog-")));
  const clock = { now: Date.parse("2026-10-21T12:00:00Z") };
  const key = generateKeyPairSync("ed25519").privateKey;
  catalog.add(moduleZip(key, "1.0.0"));
  catalog.add(moduleZip(key, "1.1.0"));
  const developer = store.createAccount({ email: "dev@example.com" }, clock.now);
  store.linkKey(developer.id, keyFingerprint(rawKey(key)), rawKey(key).toString("base64"), clock.now);
  const app = createApp({ db, catalog, rateLimiter: roomy(), reviewRateLimiter: roomy(), accounts: { store, mailer: createTestInbox(), reviews, now: () => clock.now } });
  // Users are a day old, so the minimum account age doesn't get in the way.
  const user = (email: string, name = "Mara", createdAt = clock.now - DAY) => {
    const account = store.createAccount({ email }, createdAt);
    if (name) store.setProfile(account.id, { name, initials: name.slice(0, 2).toUpperCase(), picture: PNG, updatedAt: clock.now });
    return { account, token: store.createSession(account.id, "windows", clock.now).token };
  };
  const call = (method: string, pathname: string, token?: string, body?: unknown) =>
    app.request(`http://tavora.test/v1/catalog${pathname}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const rate = (token: string, body: unknown) => call("PUT", "/modules/wellbrained.timer/review", token, body);
  return { store, reviews, catalog, clock, app, developer, user, call, rate, devToken: store.createSession(developer.id, "windows", clock.now).token };
}

describe("rating a catalog module", () => {
  it("keeps one rating per account, shows it on the listing and the module's reviews", async () => {
    const { user, rate, call, clock } = setup();
    const mara = user("mara@example.com");
    const first = await rate(mara.token, { stars: 4, text: "Handy timer.", version: "1.0.0" });
    expect(first.status).toBe(200);
    clock.now += 60_000;
    expect((await rate(mara.token, { stars: 5, text: "  Even better now!  ", version: "1.1.0" })).status).toBe(200);
    for (const [email, stars] of [["a@example.com", 3], ["b@example.com", 5]] as const) await rate(user(email, "").token, { stars, text: null, version: "1.1.0" });

    const index = (await (await call("GET", "")).json()) as { modules: { id: string; rating: unknown }[] };
    expect(index.modules[0]!.rating).toEqual({ average: 4.3, count: 3, stars: [0, 0, 1, 0, 2] });
    const page = (await (await call("GET", "/modules/wellbrained.timer")).json()) as { module: { rating: unknown } };
    expect(page.module.rating).toEqual({ average: 4.3, count: 3, stars: [0, 0, 1, 0, 2] });

    const answer = (await (await call("GET", "/modules/wellbrained.timer/reviews")).json()) as { summary: unknown; reviews: Record<string, unknown>[] };
    expect(answer.summary).toEqual({ average: 4.3, count: 3, stars: [0, 0, 1, 0, 2] });
    // Only reviews with text are listed; the account id never is.
    expect(answer.reviews).toEqual([
      {
        id: expect.any(String),
        stars: 5,
        text: "Even better now!",
        version: "1.1.0",
        createdAt: "2026-10-21T12:00:00.000Z",
        updatedAt: "2026-10-21T12:01:00.000Z",
        author: { name: "Mara", initials: "MA", picture: { sha256: createHash("sha256").update(PNG).digest("hex"), size: PNG.length } },
        reply: null,
      },
    ]);
    expect(JSON.stringify(answer)).not.toContain(mara.account.id);
  });

  it("gives the author's picture only with a shown review and its hash", async () => {
    const { user, rate, call } = setup();
    const mara = user("mara@example.com");
    const { review } = (await (await rate(mara.token, { stars: 4, text: "Nice", version: "1.0.0" })).json()) as { review: { id: string; author: { picture: { sha256: string } } } };
    const picture = await call("GET", `/reviews/${review.id}/picture/${review.author.picture.sha256}.png`);
    expect(picture.status).toBe(200);
    expect(picture.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await picture.arrayBuffer())).toEqual(PNG);
    expect((await call("GET", `/reviews/${review.id}/picture/${"0".repeat(64)}.png`)).status).toBe(404);
  });

  it("needs a sign-in, a published version and 1 to 5 stars", async () => {
    const { user, rate, call } = setup();
    const mara = user("mara@example.com");
    expect((await call("PUT", "/modules/wellbrained.timer/review", undefined, { stars: 4, text: null, version: "1.0.0" })).status).toBe(401);
    for (const body of [{ stars: 0, text: null, version: "1.0.0" }, { stars: 6, text: null, version: "1.0.0" }, { stars: 4.5, text: null, version: "1.0.0" }, { stars: 4, text: null, version: "2.0.0" }, { stars: 4, text: "x".repeat(501), version: "1.0.0" }, { stars: 4, text: null, version: "1.0.0", user: "me" }]) {
      expect((await rate(mara.token, body)).status).toBe(400);
    }
    expect((await call("PUT", "/modules/wellbrained.other/review", mara.token, { stars: 4, text: null, version: "1.0.0" })).status).toBe(404);
  });

  it("refuses the module's own publisher", async () => {
    const { rate, devToken, call } = setup();
    const answer = await rate(devToken, { stars: 5, text: "Best module ever", version: "1.0.0" });
    expect(answer.status).toBe(403);
    expect(await answer.json()).toMatchObject({ reason: "own-module" });
    expect(await (await call("GET", "/modules/wellbrained.timer/review", devToken)).json()).toEqual({ review: null, own: true });
  });

  it("holds slurs and links for the maintainer instead of showing them, and hides a name the filter refuses", async () => {
    const { user, rate, call } = setup();
    const mara = user("mara@example.com");
    const link = await rate(mara.token, { stars: 1, text: "get it at www.example.com", version: "1.0.0" });
    expect(link.status).toBe(200);
    expect(await link.json()).toMatchObject({ review: { held: true, hidden: true } });
    expect(await (await call("GET", "/modules/wellbrained.timer/reviews")).json()).toEqual({ summary: null, reviews: [] });
    const rude0 = user("rude0@example.com", "Rudi");
    expect(await (await rate(rude0.token, { stars: 1, text: "made by a f4ggot", version: "1.0.0" })).json()).toMatchObject({ review: { held: true } });
    expect(await (await call("GET", "/modules/wellbrained.timer/review", rude0.token)).json()).toMatchObject({ review: { held: true } });
    const rude = user("rude@example.com", "c u n t");
    expect((await rate(rude.token, { stars: 2, text: "Meh.", version: "1.0.0" })).status).toBe(200);
    const answer = (await (await call("GET", "/modules/wellbrained.timer/reviews")).json()) as { reviews: { author: { name: string | null } }[] };
    expect(answer.reviews[0]!.author.name).toBeNull();
  });

  it("lets the user read, change and delete their own rating", async () => {
    const { user, rate, call } = setup();
    const mara = user("mara@example.com");
    expect(await (await call("GET", "/modules/wellbrained.timer/review", mara.token)).json()).toEqual({ review: null, own: false });
    await rate(mara.token, { stars: 2, text: "Buggy", version: "1.0.0" });
    const own = (await (await call("GET", "/modules/wellbrained.timer/review", mara.token)).json()) as { review: { stars: number; version: string; hidden: boolean } };
    expect(own.review).toMatchObject({ stars: 2, version: "1.0.0", hidden: false, text: "Buggy" });
    expect((await call("DELETE", "/modules/wellbrained.timer/review", mara.token)).status).toBe(204);
    expect(await (await call("GET", "/modules/wellbrained.timer/reviews")).json()).toEqual({ summary: null, reviews: [] });
  });

  it("lets the publisher reply once under a review, and nobody else", async () => {
    const { user, rate, call, devToken } = setup();
    const mara = user("mara@example.com");
    const { review } = (await (await rate(mara.token, { stars: 2, text: "Crashes on start", version: "1.0.0" })).json()) as { review: { id: string } };
    expect((await call("PUT", `/reviews/${review.id}/reply`, mara.token, { text: "Me too" })).status).toBe(403);
    expect((await call("PUT", `/reviews/${review.id}/reply`, devToken, { text: "Fixed in 1.1.0, thanks!" })).status).toBe(200);
    expect((await call("PUT", `/reviews/${review.id}/reply`, devToken, { text: "Fixed in 1.1.0. Thanks for telling me!" })).status).toBe(200);
    const answer = (await (await call("GET", "/modules/wellbrained.timer/reviews")).json()) as { reviews: { reply: { text: string } | null }[] };
    expect(answer.reviews[0]!.reply).toMatchObject({ text: "Fixed in 1.1.0. Thanks for telling me!" });
    expect((await call("DELETE", `/reviews/${review.id}/reply`, devToken)).status).toBe(204);
    // A rating without text has nothing to answer.
    await rate(mara.token, { stars: 2, text: null, version: "1.0.0" });
    expect((await call("PUT", `/reviews/${review.id}/reply`, devToken, { text: "Hm?" })).status).toBe(404);
  });

  it("takes a report without anything about the user, and the admin page hides the text but keeps the stars", async () => {
    const { user, rate, call, reviews, store, catalog } = setup();
    const mara = user("mara@example.com");
    const { review } = (await (await rate(mara.token, { stars: 1, text: "Mean words", version: "1.0.0" })).json()) as { review: { id: string } };
    // Reporting needs a sign-in (decided 2026-10-27); the reporter is kept while the report is open.
    const signedOut = await call("POST", `/reviews/${review.id}/report`);
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toEqual({ error: "Sign in to report.", reason: "signed-out" });
    const otto = user("otto@example.com", "Otto");
    expect((await call("POST", `/reviews/${review.id}/report`, otto.token)).status).toBe(202);
    expect((await call("POST", "/reviews/AAAAAAAAAAAAAAAA/report", otto.token)).status).toBe(404);
    expect(reviews.reports()).toEqual([expect.objectContaining({ count: 1 })]);
    expect(reviews.reporters(review.id)).toEqual([{ accountId: otto.account.id, at: expect.any(Number) }]);

    const admin = createAdminApp({ token: "t".repeat(24), submissions: { listPending: () => [] } as never, state: {} as never, store: { list: () => [] } as never, catalog, accounts: store, reviews });
    const post = (pathname: string, body: unknown) => admin.request(`http://admin.test${pathname}`, { method: "POST", headers: { "x-admin-token": "t".repeat(24), "content-type": "application/json" }, body: JSON.stringify(body) });
    const listed = (await (await admin.request("http://admin.test/api/reviews", { headers: { "x-admin-token": "t".repeat(24) } })).json()) as { reports: { review: Record<string, unknown> }[] };
    expect(listed.reports[0]!.review).toMatchObject({ id: review.id, moduleName: "Timer", stars: 1, text: "Mean words", author: "Mara" });
    expect((listed.reports[0] as unknown as { reporters: unknown[] }).reporters).toEqual([{ accountId: otto.account.id, name: "Otto", reason: null, note: null, at: expect.any(String) }]);
    expect((await post("/api/reviews/hidden", { id: review.id, hidden: true })).status).toBe(200);
    expect(reviews.reports()).toEqual([]);
    expect(reviews.reporters(review.id)).toEqual([]);
    expect(await (await call("GET", "/modules/wellbrained.timer/reviews")).json()).toEqual({ summary: { average: 1, count: 1, stars: [1, 0, 0, 0, 0] }, reviews: [] });
  });

  it("deletes who reported with the reporter's account, keeping the count", async () => {
    const { user, rate, call, reviews } = setup();
    const mara = user("mara@example.com");
    const otto = user("otto@example.com", "Otto");
    const { review } = (await (await rate(mara.token, { stars: 1, text: "Mean words", version: "1.0.0" })).json()) as { review: { id: string } };
    await call("POST", `/reviews/${review.id}/report`, otto.token);
    reviews.forget(otto.account.id);
    expect(reviews.reporters(review.id)).toEqual([]);
    expect(reviews.reports()).toEqual([expect.objectContaining({ count: 1 })]);
  });

  it("forgets every rating with the account", async () => {
    const { user, rate, reviews } = setup();
    const mara = user("mara@example.com");
    await rate(mara.token, { stars: 4, text: "Nice", version: "1.0.0" });
    reviews.forget(mara.account.id);
    expect(reviews.summary("wellbrained.timer")).toBeNull();
  });
});

describe("review text", () => {
  it("is trimmed and loses controls, and stays at most 500 characters", () => {
    expect(cleanReviewText("  Good\r\n\n\n\nstuff​ ")).toBe("Good\n\nstuff");
    expect(cleanReviewText("   ")).toBeNull();
    expect(cleanReviewText(null)).toBeNull();
    expect(cleanReviewText(5)).toBeUndefined();
    expect(cleanReviewText("ä".repeat(500))).toBe("ä".repeat(500));
    expect(cleanReviewText("ä".repeat(501))).toBeUndefined();
  });
});

describe("the maintainer's queue", () => {
  it("holds filtered reviews, lists new live ones, and lets the maintainer approve, mark seen or remove", async () => {
    const { user, rate, reviews, call } = setup();
    const clean = user("clean@example.com", "Cleo");
    const rude = user("rude@example.com", "Rudi");
    await rate(clean.token, { stars: 5, text: "Works well", version: "1.0.0" });
    await rate(rude.token, { stars: 1, text: "made by a f4ggot", version: "1.0.0" });
    expect(reviews.queue().map((review) => [review.text, review.held, review.seen])).toEqual([
      ["made by a f4ggot", true, false],
      ["Works well", false, false],
    ]);
    // A held rating's stars don't count, and nothing of it shows.
    expect(await (await call("GET", "/modules/wellbrained.timer/reviews")).json()).toMatchObject({ reviews: [{ text: "Works well" }] });
    expect(reviews.summary("wellbrained.timer")?.count).toBe(1);

    const heldId = reviews.queue()[0]!.id;
    expect(reviews.approve(heldId)).toBe(true);
    expect(reviews.approve(heldId)).toBe(false);
    expect(reviews.summary("wellbrained.timer")?.count).toBe(2);
    expect(reviews.markSeen(reviews.queue().map((review) => review.id))).toBe(1);
    expect(reviews.queue()).toEqual([]);

    expect(reviews.remove(heldId)).toBe(true);
    expect(reviews.summary("wellbrained.timer")?.count).toBe(1);
    expect(reviews.remove(heldId)).toBe(false);
  });

  it("puts a held review back in the queue when its author edits it, and releases it when the new text is clean", async () => {
    const { user, rate, reviews } = setup();
    const mara = user("mara@example.com");
    await rate(mara.token, { stars: 1, text: "get it at www.example.com", version: "1.0.0" });
    expect(reviews.queue()[0]).toMatchObject({ held: true });
    await rate(mara.token, { stars: 2, text: "Not for me, sorry", version: "1.0.0" });
    expect(reviews.queue()[0]).toMatchObject({ held: false, hidden: false, seen: false });
    expect(reviews.summary("wellbrained.timer")?.count).toBe(1);
  });

  it("holds a module's 21st new rating of the day, keeps it held through edits, and lets the maintainer approve it", async () => {
    const { user, rate, reviews, clock } = setup();
    for (let index = 0; index < 20; index++) reviews.rate(`account-${index}`, "wellbrained.timer", { stars: 1, text: null, version: "1.0.0" }, clock.now - index * 60_000);
    const mara = user("mara@example.com");
    expect(await (await rate(mara.token, { stars: 5, text: null, version: "1.0.0" })).json()).toMatchObject({ review: { held: true } });
    expect(reviews.queue()[0]).toMatchObject({ held: true, capped: true, text: null });
    expect(reviews.summary("wellbrained.timer")?.count).toBe(20);
    expect(await (await rate(mara.token, { stars: 4, text: "Clean words", version: "1.0.0" })).json()).toMatchObject({ review: { held: true } });
    expect(reviews.approve(reviews.queue()[0]!.id)).toBe(true);
    expect(reviews.summary("wellbrained.timer")?.count).toBe(21);
    // A day later the module takes new ratings again.
    clock.now += DAY;
    expect(await (await rate(user("next@example.com").token, { stars: 3, text: null, version: "1.0.0" })).json()).toMatchObject({ review: { held: false } });
  });
});

describe("rating limits", () => {
  it("refuses an account younger than a day, with the hours left", async () => {
    const { user, rate, clock } = setup();
    const fresh = user("fresh@example.com", "Fia", clock.now - 4.5 * 3_600_000);
    const answer = await rate(fresh.token, { stars: 5, text: null, version: "1.0.0" });
    expect(answer.status).toBe(403);
    expect(await answer.json()).toMatchObject({ reason: "account-too-new", hours: 20 });
    clock.now += 20 * 3_600_000;
    expect((await rate(fresh.token, { stars: 5, text: null, version: "1.0.0" })).status).toBe(200);
  });

  it("lets an account give 10 new ratings a day, edits free, and counts deleting and rating again", async () => {
    const { user, rate, call, reviews, clock } = setup();
    const mara = user("mara@example.com");
    for (let index = 0; index < 9; index++) reviews.rate(mara.account.id, `wellbrained.other${index}`, { stars: 3, text: null, version: "1.0.0" }, clock.now - 3_600_000 * (index + 1));
    expect((await rate(mara.token, { stars: 4, text: null, version: "1.0.0" })).status).toBe(200);
    expect((await rate(mara.token, { stars: 5, text: "Changed my mind", version: "1.0.0" })).status).toBe(200);
    expect((await call("DELETE", "/modules/wellbrained.timer/review", mara.token)).status).toBe(204);
    const again = await rate(mara.token, { stars: 5, text: null, version: "1.0.0" });
    expect(again.status).toBe(429);
    // The oldest of the ten was given 9 hours ago, so a slot opens in 15.
    expect(await again.json()).toMatchObject({ reason: "daily-limit", hours: 15 });
    clock.now += 15 * 3_600_000;
    expect((await rate(mara.token, { stars: 5, text: null, version: "1.0.0" })).status).toBe(200);
  });
});
