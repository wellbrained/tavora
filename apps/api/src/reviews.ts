import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Account, AccountStore } from "./account-store.ts";
import type { CatalogStore } from "./catalog.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";
import { checkReviewText } from "./review-filter.ts";

/**
 * Module ratings and reviews (decided 2026-10-21). A signed-in account rates a catalog module once,
 * with 1 to 5 stars and an optional review of at most 500 characters, and can change or delete it.
 * The app offers it only for a module the player has installed; the service cannot know that and
 * does not try. Nobody rates a module of their own: an account that holds the id's prefix, or whose
 * key owns the module, is refused. Each rating keeps the version it was given on, and every version
 * counts. A review goes live at once, past a word filter (review-filter.ts); anyone can report one,
 * and a person hides it on the admin page. A hidden review's stars still count. Suspending its account hides all of its reviews the same way
 * (hideForSuspension), and unsuspending shows exactly those again.
 *
 * A review shows its author's profile name and picture, and only there: the profile stays private
 * everywhere else. Reviews live in their own file, keyed by the account id, and go with the account.
 */

export const MAX_REVIEW_LENGTH = 500;
/** Ratings a module needs before its average is shown; below that the app says "New". */
export const MIN_RATINGS_SHOWN = 3;
/** Newest reviews with text one page shows. */
export const REVIEWS_SHOWN = 100;

export interface RatingSummary {
  average: number;
  count: number;
  /** How many ratings gave 1, 2, 3, 4 and 5 stars, in that order. */
  stars: [number, number, number, number, number];
}

export interface StoredReview {
  id: string;
  accountId: string;
  moduleId: string;
  stars: number;
  text: string | null;
  version: string;
  createdAt: number;
  updatedAt: number;
  hidden: boolean;
  /** Held for the maintainer: the word filter found something, so nobody sees the text or counts the stars until it is approved. */
  held: boolean;
  /** Whether the maintainer has looked at it (new ones sit in the admin's queue). */
  seen: boolean;
  reply: { text: string; updatedAt: number } | null;
}

export interface ReviewReport {
  review: StoredReview;
  count: number;
  firstAt: number;
  lastAt: number;
}

interface ReviewSql {
  id: string;
  account_id: string;
  module_id: string;
  stars: number;
  text: string | null;
  version: string;
  created_at: number;
  updated_at: number;
  hidden: number;
  held: number;
  reviewed: number;
  reply: string | null;
  reply_at: number | null;
}

const REVIEW_COLUMNS = "r.id, r.account_id, r.module_id, r.stars, r.text, r.version, r.created_at, r.updated_at, r.hidden, r.held, r.reviewed, p.text as reply, p.updated_at as reply_at";
const REVIEW_FROM = "reviews r left join replies p on p.review_id = r.id";

function toReview(row: ReviewSql | undefined): StoredReview | null {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    moduleId: row.module_id,
    stars: row.stars,
    text: row.text,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hidden: row.hidden === 1,
    held: row.held === 1,
    seen: row.reviewed === 1,
    reply: row.reply === null ? null : { text: row.reply, updatedAt: row.reply_at ?? row.updated_at },
  };
}

/** The ratings, reviews, publisher replies and review reports, in `reviews.sqlite` of the state directory. */
export class ReviewStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      pragma journal_mode = wal;
      pragma foreign_keys = on;
      create table if not exists reviews (
        id text primary key, account_id text not null, module_id text not null,
        stars integer not null check (stars between 1 and 5), text text, version text not null,
        created_at integer not null, updated_at integer not null, hidden integer not null default 0,
        unique (account_id, module_id)
      );
      create index if not exists reviews_module on reviews (module_id, updated_at);
      create table if not exists replies (
        review_id text primary key references reviews (id) on delete cascade, text text not null, updated_at integer not null
      );
      create table if not exists review_reports (
        review_id text primary key references reviews (id) on delete cascade,
        count integer not null, first_at integer not null, last_at integer not null
      );
    `);
    // Reviews hidden because their account is suspended (decided 2026-10-26), so unsuspending shows exactly these again.
    const columns = (this.db.prepare("pragma table_info(reviews)").all() as unknown as { name: string }[]).map((column) => column.name);
    // Held reviews and the queue (decided 2026-10-27). Reviews that already exist count as seen.
    if (!columns.includes("held")) this.db.exec("alter table reviews add column held integer not null default 0");
    if (!columns.includes("reviewed")) this.db.exec("alter table reviews add column reviewed integer not null default 1");
    if (!columns.includes("hidden_by_suspend")) this.db.exec("alter table reviews add column hidden_by_suspend integer not null default 0");
  }

  close(): void {
    this.db.close();
  }

  /** Every module's ratings at once, for the catalog index. */
  summaries(): Map<string, RatingSummary> {
    const rows = this.db.prepare("select module_id, stars, count(*) as n from reviews where held = 0 group by module_id, stars").all() as unknown as { module_id: string; stars: number; n: number }[];
    const stars = new Map<string, RatingSummary["stars"]>();
    for (const row of rows) {
      const counts = stars.get(row.module_id) ?? [0, 0, 0, 0, 0];
      counts[row.stars - 1] = row.n;
      stars.set(row.module_id, counts);
    }
    return new Map([...stars].map(([id, counts]) => [id, summaryOf(counts)]));
  }

  /** One module's ratings, or null without any. */
  summary(moduleId: string): RatingSummary | null {
    const rows = this.db.prepare("select stars, count(*) as n from reviews where module_id = ? and held = 0 group by stars").all(moduleId) as unknown as { stars: number; n: number }[];
    if (!rows.length) return null;
    const counts: RatingSummary["stars"] = [0, 0, 0, 0, 0];
    for (const row of rows) counts[row.stars - 1] = row.n;
    return summaryOf(counts);
  }

  /** A module's newest reviews with text that are not hidden. */
  reviews(moduleId: string, limit = REVIEWS_SHOWN): StoredReview[] {
    return (
      this.db
        .prepare(`select ${REVIEW_COLUMNS} from ${REVIEW_FROM} where r.module_id = ? and r.text is not null and r.hidden = 0 order by r.updated_at desc, r.id limit ?`)
        .all(moduleId, limit) as unknown as ReviewSql[]
    ).map((row) => toReview(row)!);
  }

  review(id: string): StoredReview | null {
    return toReview(this.db.prepare(`select ${REVIEW_COLUMNS} from ${REVIEW_FROM} where r.id = ?`).get(id) as ReviewSql | undefined);
  }

  /** The account's rating of a module, or null. */
  own(accountId: string, moduleId: string): StoredReview | null {
    return toReview(this.db.prepare(`select ${REVIEW_COLUMNS} from ${REVIEW_FROM} where r.account_id = ? and r.module_id = ?`).get(accountId, moduleId) as ReviewSql | undefined);
  }

  /**
   * Sets the account's rating of a module, keeping its id, its reply and whether it is hidden. Taking
   * the text out takes the publisher's reply with it: a reply always answers a text.
   */
  rate(accountId: string, moduleId: string, input: { stars: number; text: string | null; version: string; held?: boolean }, now: number): StoredReview {
    const current = this.own(accountId, moduleId);
    if (current) {
      const held = input.held ? 1 : 0;
      this.db
        .prepare(
          "update reviews set stars = ?, text = ?, version = ?, updated_at = ?, hidden = case when ? = 1 then 1 when held = 1 then 0 else hidden end, held = ?, reviewed = case when ? is null then 1 else 0 end where id = ?",
        )
        .run(input.stars, input.text, input.version, now, held, held, input.text, current.id);
      if (input.text === null) this.db.prepare("delete from replies where review_id = ?").run(current.id);
      return this.review(current.id)!;
    }
    const id = randomBytes(12).toString("base64url");
    this.db
      .prepare("insert into reviews (id, account_id, module_id, stars, text, version, created_at, updated_at, hidden, held, reviewed) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, accountId, moduleId, input.stars, input.text, input.version, now, now, input.held ? 1 : 0, input.held ? 1 : 0, input.text === null ? 1 : 0);
    return this.review(id)!;
  }

  /** Deletes the account's rating of a module, with its reply and reports. */
  unrate(accountId: string, moduleId: string): boolean {
    return Number(this.db.prepare("delete from reviews where account_id = ? and module_id = ?").run(accountId, moduleId).changes) > 0;
  }

  /** The publisher's reply to a review with text; false when there is no such review. */
  setReply(reviewId: string, text: string | null, now: number): boolean {
    const review = this.review(reviewId);
    if (!review || review.text === null) return false;
    if (text === null) this.db.prepare("delete from replies where review_id = ?").run(reviewId);
    else this.db.prepare("insert into replies (review_id, text, updated_at) values (?, ?, ?) on conflict (review_id) do update set text = excluded.text, updated_at = excluded.updated_at").run(reviewId, text, now);
    return true;
  }

  /** What waits for the maintainer: held reviews, and live ones with text that nobody has looked at yet. Newest first. */
  queue(): StoredReview[] {
    return (
      this.db.prepare(`select ${REVIEW_COLUMNS} from ${REVIEW_FROM} where r.held = 1 or (r.reviewed = 0 and r.text is not null) order by r.updated_at desc, r.id`).all() as unknown as ReviewSql[]
    ).map((row) => toReview(row)!);
  }

  /** The maintainer lets a held review through: its text shows and its stars count. False when it isn't held. */
  approve(reviewId: string): boolean {
    return Number(this.db.prepare("update reviews set held = 0, hidden = 0, reviewed = 1, hidden_by_suspend = 0 where id = ? and held = 1").run(reviewId).changes) > 0;
  }

  /** The maintainer has looked at these live reviews. Returns how many were new. */
  markSeen(ids: readonly string[]): number {
    let changed = 0;
    for (const id of ids) changed += Number(this.db.prepare("update reviews set reviewed = 1 where id = ? and reviewed = 0").run(id).changes);
    return changed;
  }

  /** The maintainer removes a rating for good: its text, reply, reports and stars are gone. */
  remove(reviewId: string): boolean {
    return Number(this.db.prepare("delete from reviews where id = ?").run(reviewId).changes) > 0;
  }

  /** Records that a player pressed Report on a shown review. Nothing about who pressed it is kept. */
  report(reviewId: string, now: number): boolean {
    const review = this.review(reviewId);
    if (!review || review.text === null || review.hidden) return false;
    this.db
      .prepare("insert into review_reports (review_id, count, first_at, last_at) values (?, 1, ?, ?) on conflict (review_id) do update set count = count + 1, last_at = excluded.last_at")
      .run(reviewId, now, now);
    return true;
  }

  /** Reported reviews, most reported first, for the admin page. */
  reports(): ReviewReport[] {
    const rows = this.db
      .prepare(`select ${REVIEW_COLUMNS}, x.count, x.first_at, x.last_at from review_reports x join reviews r on r.id = x.review_id left join replies p on p.review_id = r.id order by x.count desc, x.last_at desc`)
      .all() as unknown as (ReviewSql & { count: number; first_at: number; last_at: number })[];
    return rows.map((row) => ({ review: toReview(row)!, count: row.count, firstAt: row.first_at, lastAt: row.last_at }));
  }

  dismissReport(reviewId: string): boolean {
    return Number(this.db.prepare("delete from review_reports where review_id = ?").run(reviewId).changes) > 0;
  }

  /**
   * Hides a review's text (its stars still count) or shows it again. Hiding closes its report. A person's choice
   * here is final: the review is no longer one that a suspension hid, so unsuspending leaves it as set.
   */
  setHidden(reviewId: string, hidden: boolean): boolean {
    const changed = Number(this.db.prepare("update reviews set hidden = ?, hidden_by_suspend = 0 where id = ?").run(hidden ? 1 : 0, reviewId).changes) > 0;
    if (changed && hidden) this.dismissReport(reviewId);
    return changed;
  }

  /**
   * The account is suspended: every review it wrote is hidden (text and publisher reply off, like Hide), and
   * its open reports close. Its stars still count, as for any hidden review. Returns how many were hidden now.
   */
  hideForSuspension(accountId: string): number {
    this.db.prepare("delete from review_reports where review_id in (select id from reviews where account_id = ? and hidden = 0)").run(accountId);
    return Number(this.db.prepare("update reviews set hidden = 1, hidden_by_suspend = 1 where account_id = ? and hidden = 0").run(accountId).changes);
  }

  /** The account is unsuspended: the reviews the suspension hid show again; ones a person hid stay hidden. Returns how many. */
  showAfterSuspension(accountId: string): number {
    return Number(this.db.prepare("update reviews set hidden = 0, hidden_by_suspend = 0 where account_id = ? and hidden_by_suspend = 1").run(accountId).changes);
  }

  /** How many reviews (ratings) an account wrote, and how many of them are hidden. */
  countByAccount(accountId: string): { written: number; hidden: number } {
    const row = this.db.prepare("select count(*) as written, coalesce(sum(hidden), 0) as hidden from reviews where account_id = ?").get(accountId) as { written: number; hidden: number };
    return { written: row.written, hidden: row.hidden };
  }

  /** Everything an account wrote goes when the account does. */
  forget(accountId: string): void {
    this.db.prepare("delete from reviews where account_id = ?").run(accountId);
  }
}

function summaryOf(stars: RatingSummary["stars"]): RatingSummary {
  const count = stars.reduce((sum, n) => sum + n, 0);
  const total = stars.reduce((sum, n, index) => sum + n * (index + 1), 0);
  return { average: count ? Math.round((total / count) * 10) / 10 : 0, count, stars };
}

/** A review or reply as typed: trimmed, without controls, at most two blank lines in a row. Null for an empty one. */
export function cleanReviewText(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  return [...text].length <= MAX_REVIEW_LENGTH ? text : undefined;
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MODULE_ID = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*){1,4}$/;
const REVIEW_ID = /^[A-Za-z0-9_-]{16}$/;

export interface ReviewOptions {
  reviews: ReviewStore;
  catalog: CatalogStore;
  accounts: AccountStore;
  clientKey: (request: Request) => string;
  /** Ratings, replies and reports written per client: 30 an hour by default. */
  writeRateLimiter?: RateLimiter;
  now?: () => number;
}

type Env = { Variables: { account: Account } };

/** The answer for a review: what a player sees, never the account id. */
function reviewAnswer(review: StoredReview, accounts: AccountStore) {
  const profile = accounts.profile(review.accountId);
  // A name the filter would refuse is not shown on a review.
  const name = profile?.name.trim() && checkReviewText(profile.name) === "ok" ? profile.name.trim() : null;
  return {
    id: review.id,
    stars: review.stars,
    text: review.hidden ? null : review.text,
    version: review.version,
    createdAt: new Date(review.createdAt).toISOString(),
    updatedAt: new Date(review.updatedAt).toISOString(),
    author: {
      name,
      initials: name ? profile!.initials : null,
      // Fetched by the review it belongs to, and checked against this hash and size by the app.
      picture: profile?.picture ? { sha256: createHash("sha256").update(profile.picture).digest("hex"), size: profile.picture.length } : null,
    },
    reply: review.reply && !review.hidden ? { text: review.reply.text, updatedAt: new Date(review.reply.updatedAt).toISOString() } : null,
  };
}

/** Whether an account is the module's own publisher: it holds the id's prefix, or its key owns the module. */
export function ownsModule(accounts: AccountStore, accountId: string, moduleId: string, owner: string): boolean {
  return accounts.prefixes(accountId).includes(moduleId.split(".")[0]!) || accounts.publisherKey(owner)?.accountId === accountId;
}

/**
 * The review routes under /v1/catalog. Reading needs no sign-in; rating, replying and the own rating
 * need one. Bodies are JSON, which a web page on another site cannot send without a preflight.
 */
export function reviewRoutes({ reviews, catalog, accounts, clientKey, writeRateLimiter, now = Date.now }: ReviewOptions) {
  const writeLimiter = writeRateLimiter ?? createRateLimiter({ limit: 30, windowMs: 3_600_000 });
  const app = new Hono<Env>();
  const tooMany = (context: Context, wait: number) => {
    context.header("Retry-After", String(wait));
    return context.json({ error: "Too many requests. Try again later.", reason: "too-many" }, 429);
  };

  const signedIn = async (context: Context<Env>, next: () => Promise<void>) => {
    const match = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(context.req.header("authorization") ?? "");
    const session = match ? accounts.sessionByToken(match[1]!, now()) : null;
    const account = session ? accounts.account(session.accountId) : null;
    if (!account) return context.json({ error: "Sign in to rate modules.", reason: "signed-out" }, 401);
    context.set("account", account);
    context.header("Cache-Control", "no-store");
    await next();
  };
  const writes = async (context: Context<Env>, next: () => Promise<void>) => {
    if (context.req.method === "GET") return next();
    const wait = writeLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    if (context.req.method === "PUT" && !(context.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return context.json({ error: "Send JSON.", reason: "bad-request" }, 415);
    }
    await next();
  };
  const small = bodyLimit({ maxSize: 4000, onError: (context) => context.json({ error: "Too big.", reason: "bad-request" }, 413) });
  const body = async (context: Context): Promise<Record<string, unknown> | null> => {
    try {
      const value = JSON.parse(await context.req.text()) as unknown;
      return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const refused = (context: Context, result: "words" | "link") =>
    result === "link"
      ? context.json({ error: "Reviews can't hold links or email addresses.", reason: "review-link" }, 400)
      : context.json({ error: "Some words in it aren't allowed.", reason: "review-words" }, 400);

  // A module's ratings and newest reviews.
  app.get("/modules/:id/reviews", (context) => {
    const id = context.req.param("id");
    if (!MODULE_ID.test(id) || !catalog.module(id)) return context.json({ error: "Not found." }, 404);
    context.header("Cache-Control", "public, max-age=60");
    return context.json({ summary: reviews.summary(id), reviews: reviews.reviews(id).map((review) => reviewAnswer(review, accounts)) });
  });

  // A reviewer's picture, by the review it is shown with and the hash the review answer gave.
  app.get("/reviews/:id/picture/:file", (context) => {
    const id = context.req.param("id");
    const sha = /^([0-9a-f]{64})\.png$/.exec(context.req.param("file"))?.[1];
    const review = REVIEW_ID.test(id) && sha ? reviews.review(id) : null;
    if (!review || review.text === null || review.hidden || !catalog.module(review.moduleId)) return context.json({ error: "Not found." }, 404);
    const picture = accounts.profile(review.accountId)?.picture;
    if (!picture || createHash("sha256").update(picture).digest("hex") !== sha) return context.json({ error: "Not found." }, 404);
    return new Response(new Uint8Array(picture), {
      headers: { "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'", "Cache-Control": "public, max-age=86400" },
    });
  });

  // Report a review: no body, and nothing about who pressed it.
  app.post("/reviews/:id/report", async (context) => {
    const wait = writeLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait);
    const id = context.req.param("id");
    if (!REVIEW_ID.test(id) || !reviews.report(id, now())) return context.json({ error: "Not found." }, 404);
    return context.json({ status: "received" }, 202);
  });

  // The signed-in account's own rating of a module.
  app.use("/modules/:id/review", writes, small, signedIn);
  app.get("/modules/:id/review", (context) => {
    const id = context.req.param("id");
    const listed = MODULE_ID.test(id) ? catalog.module(id) : null;
    if (!listed) return context.json({ error: "Not found.", reason: "not-found" }, 404);
    const account = context.get("account").id;
    const own = reviews.own(account, id);
    return context.json({ review: own ? { ...reviewAnswer(own, accounts), hidden: own.hidden, held: own.held, text: own.text } : null, own: ownsModule(accounts, account, id, listed.module.owner) });
  });
  app.put("/modules/:id/review", async (context) => {
    const id = context.req.param("id");
    const listed = MODULE_ID.test(id) ? catalog.module(id) : null;
    if (!listed) return context.json({ error: "Not found.", reason: "not-found" }, 404);
    const account = context.get("account").id;
    if (ownsModule(accounts, account, id, listed.module.owner)) return context.json({ error: "You can't rate your own module.", reason: "own-module" }, 403);
    const input = await body(context);
    const text = cleanReviewText(input?.text);
    if (
      !input ||
      Object.keys(input).some((key) => !["stars", "text", "version"].includes(key)) ||
      typeof input.stars !== "number" ||
      !Number.isInteger(input.stars) ||
      input.stars < 1 ||
      input.stars > 5 ||
      text === undefined ||
      typeof input.version !== "string" ||
      !SEMVER.test(input.version) ||
      !listed.versions.some((version) => version.version === input.version)
    ) {
      return context.json({ error: "Send { stars: 1 to 5, text: at most 500 characters or null, version: a published version }.", reason: "bad-request" }, 400);
    }
    // The word filter no longer refuses: what it finds waits for the maintainer, and the author sees it is waiting.
    const held = text !== null && checkReviewText(text) !== "ok";
    const review = reviews.rate(account, id, { stars: input.stars, text, version: input.version, held }, now());
    return context.json({ review: { ...reviewAnswer(review, accounts), hidden: review.hidden, held: review.held, text: review.text } });
  });
  app.delete("/modules/:id/review", (context) => {
    const id = context.req.param("id");
    if (!MODULE_ID.test(id)) return context.json({ error: "Not found.", reason: "not-found" }, 404);
    reviews.unrate(context.get("account").id, id);
    return context.body(null, 204);
  });

  // The publisher's one reply under a review of their module.
  app.use("/reviews/:id/reply", writes, small, signedIn);
  const publisherOf = (context: Context<Env>) => {
    const id = context.req.param("id")!;
    const review = REVIEW_ID.test(id) ? reviews.review(id) : null;
    const listed = review ? catalog.module(review.moduleId) : null;
    if (!review || !listed || review.text === null || review.hidden) return null;
    return ownsModule(accounts, context.get("account").id, review.moduleId, listed.module.owner) ? review : false;
  };
  app.put("/reviews/:id/reply", async (context) => {
    const review = publisherOf(context);
    if (review === null) return context.json({ error: "Not found.", reason: "not-found" }, 404);
    if (review === false) return context.json({ error: "Only the module's publisher can reply.", reason: "not-publisher" }, 403);
    const input = await body(context);
    const text = cleanReviewText(input?.text);
    if (!input || Object.keys(input).join() !== "text" || typeof text !== "string") return context.json({ error: "Send { text: at most 500 characters }.", reason: "bad-request" }, 400);
    const check = checkReviewText(text);
    if (check !== "ok") return refused(context, check);
    reviews.setReply(review.id, text, now());
    return context.json({ review: reviewAnswer(reviews.review(review.id)!, accounts) });
  });
  app.delete("/reviews/:id/reply", (context) => {
    const review = publisherOf(context);
    if (review === null) return context.json({ error: "Not found.", reason: "not-found" }, 404);
    if (review === false) return context.json({ error: "Only the module's publisher can reply.", reason: "not-publisher" }, 403);
    reviews.setReply(review.id, null, now());
    return context.body(null, 204);
  });

  return app;
}
