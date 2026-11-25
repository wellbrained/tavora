import type { Context } from "hono";
import { PUBLISH_STATEMENT, ZIP_LIMITS } from "@tavora/pack";
import { PUBLISH_TOKEN_PREFIX, type AccountStore, type UnsentNotice } from "./account-store.ts";
import { bearerToken, fail as refuse, tooMany } from "./sign-in.ts";
import { MAIL_RESERVED, NOTICES_PER_ACCOUNT, noticeRoom } from "./accounts.ts";
import { CatalogError, checkCatalogZip, checkReleaseVersion, isOfficialId, type CatalogStore, type CheckedZip, type ReviewReason } from "./catalog.ts";
import { catalogTrust, keyRefusal, OFFICIAL_PINS, officialOn, type OfficialPins } from "./catalog-trust.ts";
import { mailLanguage, publishedMail, withdrawnMail, type Mail, type MailLanguage, type Mailer } from "./mail.ts";
import { waitingMail, waitingNoticeMail } from "./moderation-mail.ts";
import { reviewUpload, runChecks } from "./moderation.ts";
import { signedStatement } from "./publishers.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";
import { FREE_AFTER_BYTES, freeMemory, heldBytes, readUpload, uploadMemory, type MemoryTicket, type ReadLimits, type UploadMemory, zipPlan } from "./upload-memory.ts";
import type { Scanner } from "./virus-scan.ts";
import { sha256Hex } from "./hash.ts";

/**
 * Publishing to the catalog (Milestone E, step 3): `tavora-pack publish` sends a zip it packed, with
 * the publisher key's signature over PUBLISH_STATEMENT and the zip's SHA-256. The key must be linked to
 * an account, and the account holds the module id's prefix (C5). The upload also carries the account's
 * sign-in (Tavora uploads for tavora-pack) or one of its publish tokens (CI), so a stolen key alone
 * publishes nothing (decided 2026-10-20; key-only uploads stopped at once). A token publishes only under
 * prefixes the account holds already. The account's address gets an email after every publish. Signing the hash, not only the files, means a zip shared by hand cannot be published
 * by whoever received it; only the key's holder decides what lists. A revoked key publishes nothing
 * new (C6), and a successor key publishes the modules of the key it replaces (C7), both by the lists
 * signed with the catalogue key.
 *
 * Tavora's own modules (ids starting with `tavora.`) are the exception to the id rules: an update is taken only when the pins are set,
 * the zip is signed by the pinned publisher key (or a successor in the pinned account), the pinned account uploads it with its
 * sign-in (never a publish token) and the manifest names `minTavora`. It lists at once, without waiting for a person; the automatic
 * checks still run and their reasons are kept with the version. Without pins every `tavora.*` upload is refused. The prefix `tavora`
 * is never reserved for an account.
 *
 * Review before listing (decided 2026-10-26): every new version runs the automatic checks of moderation.ts. All pass: it lists at once
 * (201). Any fails, it is the first module of an account that has had nothing approved, or its pictures are new: it waits (202), not
 * listed, its zip kept privately, until a person approves it on the review page. Nothing approves a version by itself, and a check that
 * cannot run counts as failed. A banned account publishes nothing (403 banned).
 */
export interface PublishLimits {
  /** Versions one account may have waiting for review at once. */
  waitingPerAccount: number;
  /** Uploads per account in 24 hours (C9). */
  uploadsPerDay: number;
  /** Bytes of zips one account may have stored. */
  accountBytes: number;
  /** Bytes of zips in the whole catalog; past it uploads answer 507. */
  catalogBytes: number;
  /** Versions of a module that keep their zip; a new version deletes the zips of older ones. */
  keepVersions: number;
}

export const PUBLISH_LIMITS: Readonly<PublishLimits> = {
  waitingPerAccount: 5,
  uploadsPerDay: 10,
  accountBytes: 200 * 1024 * 1024,
  catalogBytes: 20 * 1024 * 1024 * 1024,
  keepVersions: 3,
};

export interface PublishOptions {
  catalog: CatalogStore | undefined;
  store: AccountStore | undefined;
  clientKey: (request: Request) => string;
  /** Uploads per client: 30 an hour by default. */
  rateLimiter?: RateLimiter;
  /** Looking at and withdrawing waiting versions, per client: 120 an hour by default, apart from the uploads. */
  waitingRateLimiter?: RateLimiter;
  limits?: Partial<PublishLimits>;
  now?: () => number;
  /** The catalogue public key the signed lists are checked against (CATALOGUE_PUBLIC_KEY outside tests). */
  catalogueKey?: string;
  /** The pinned key and account that may publish `tavora.*` modules (OFFICIAL_PINS by default; empty: nobody). */
  officialPins?: OfficialPins;
  /**
   * Who is told when the catalog is full (MAINTAINER_EMAIL), and how. Absent: only the review page shows it.
   * The account with this address has no daily upload limit.
   */
  maintainer?: { email: string; mailer: Mailer; mailDailyLimit?: number };
  /** How the developer is told about each publish. Absent: nobody is (tests that don't look). */
  mail?: { mailer: Mailer; mailDailyLimit?: number };
  /** The virus scanner of the automatic checks. Without one every new version waits for review. */
  scanner?: Scanner | undefined;
  /** What uploads may hold in memory at once (the process's shared budget by default). */
  memory?: UploadMemory;
  /** How patient the read of an upload is (the catalog's own limits by default). */
  readLimits?: ReadLimits;
  /** The longest a virus scan may take (SCAN_LIMIT_MS by default). */
  scanLimitMs?: number;
}

/** Why a version of a taken-down module waits: it can't go live until a person puts the module back. */
const TAKEN_DOWN: ReviewReason = { check: "taken-down", text: "This module was taken down, so a person looks at this version first." };

export function catalogFullMail(to: string, usedBytes: number, catalogBytes: number): Mail {
  const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
  return {
    to,
    subject: "Tavora's module catalog is full",
    text:
      `The module catalog holds ${mb(usedBytes)} MB of its ${mb(catalogBytes)} MB, so new uploads are refused with 507.\n\n` +
      "Make room by removing old zips, or raise the catalog's limit, and uploads work again. The review page shows this until an upload fits.\n\n" +
      "You get this email at most once a day.\n\nTavora\n",
  };
}

/** A refusal because the whole catalog is full: the maintainer is told too (tellFull), which no other refusal does. */
interface CatalogFull {
  full: Response;
}
/** What a limit check says: a refusal, a full catalog, or null when there is room. */
type LimitCheck = Response | CatalogFull | null;

/** A publish token that doesn't work (any more): said as such, so CI doesn't read it as a client to update. */
const TOKEN_GONE = "This publish token doesn't work any more: it was removed, ran out, or your account's email changed. Make a new one in Tavora (Settings > Publishing > Publisher keys and CI).";
/** Whether the request came with something shaped like a publish token. */
const sentToken = (context: Context) => bearerToken(context)?.startsWith(PUBLISH_TOKEN_PREFIX) ?? false;
const PAUSED_KEY = "This publisher key was paused when your account's email changed. Link it again to publish with it.";

/** The middleware and handler for POST /v1/catalog/publish. */
export function publishHandlers({ catalog, store, clientKey, rateLimiter, waitingRateLimiter, limits = {}, now = Date.now, catalogueKey, officialPins = OFFICIAL_PINS, maintainer, mail, scanner, memory = uploadMemory, readLimits = {}, scanLimitMs }: PublishOptions) {
  const limiter = rateLimiter ?? createRateLimiter({ limit: 30, windowMs: 3_600_000 });
  // An app that checks its waiting versions now and then must not use up the uploads.
  const waitingLimiter = waitingRateLimiter ?? createRateLimiter({ limit: 120, windowMs: 3_600_000 });
  const { uploadsPerDay, accountBytes, catalogBytes, keepVersions, waitingPerAccount } = { ...PUBLISH_LIMITS, ...limits };
  const tooBig = (context: Context) => refuse(context, 413, "too-big", `A module zip may be at most ${ZIP_LIMITS.maxArchiveBytes / 1024 / 1024} MB.`);
  /** The accounts with an upload holding memory now: each gets one at a time, so one account can't hold the whole budget. */
  const uploading = new Set<string>();

  // Tells the maintainer by email, at most once a day; the review page shows it either way (C9).
  const tellFull = async (catalog: CatalogStore, store: AccountStore, at: number, usedBytes: number) => {
    const when = new Date(at);
    if (!catalog.markFull(when) || !maintainer) return;
    const day = when.toISOString().slice(0, 10);
    // Sign-in codes come first: this notice never uses the emails kept for them.
    if (maintainer.mailDailyLimit !== undefined && store.mailsSent(day) >= Math.max(0, maintainer.mailDailyLimit - MAIL_RESERVED)) {
      catalog.giveBackFullNotice(when);
      return;
    }
    // Claimed (markFull) and counted before the send, so uploads at the same time send one; given back when it fails.
    store.countMail(day);
    try {
      await maintainer.mailer.send(catalogFullMail(maintainer.email, usedBytes, catalogBytes));
    } catch {
      // The review page still shows it; the email is best effort, and the next refused upload tries again.
      store.uncountMail(day);
      catalog.giveBackFullNotice(when);
    }
  };

  /** The refusal for a banned or suspended account, or null. */
  const stoppedAccount = (store: AccountStore, accountId: string, context: Context) => {
    if (store.isBanned(accountId)) return refuse(context, 403, "banned", "This account can't use the catalog any more. Check your email for why.");
    if (store.isSuspended(accountId)) return refuse(context, 403, "suspended", "This account is suspended. Check your email for why.");
    return null;
  };

  /** Too many big uploads are being checked right now; this one is asked to come back. */
  const busy = (context: Context) => tooMany(context, 60, "Tavora is checking other uploads. Try again in a minute.");

  /** The linked key of a zip's signer, or the refusal: not linked, not this upload's signature, or another account's. */
  const signerKey = (store: AccountStore, context: Context, owner: string, sha256: string, signature: string | undefined, accountId: string) => {
    const key = store.publisherKey(owner);
    if (!key) {
      // A leaked key whose account unlinked it or was deleted says so, rather than asking to link it (which is refused).
      if (store.isLeakedKey(owner)) return refuse(context, 403, "key-leaked", "This publisher key was reported as leaked, so it can't publish. Use a new key.");
      return refuse(context, 403, "key-not-linked", "This publisher key is not linked to a Tavora account.");
    }
    if (!signedStatement(Buffer.from(key.publicKey, "base64"), `${PUBLISH_STATEMENT}\n${sha256}`, signature)) {
      return refuse(context, 403, "bad-signature", "The upload is not signed by the key that signed the zip.");
    }
    if (accountId !== key.accountId) return refuse(context, 403, "wrong-account", "This publisher key is linked to another Tavora account than the one publishing.");
    // Paused when the account's address changed (account-store.ts revokeMinted). Apps know to link a key that isn't linked,
    // and linking it again wakes it, so it answers with that reason.
    if (key.paused) return refuse(context, 403, "key-not-linked", PAUSED_KEY);
    return key;
  };

  /** Who uploads: a signed-in Tavora, or a publish token (with its name). Null without either. */
  const uploader = (store: AccountStore, context: Context, at: number): { accountId: string; token: string | null } | null => {
    const bearer = bearerToken(context);
    if (!bearer) return null;
    const byToken = store.publishTokenAccount(bearer, at);
    if (byToken) return { accountId: byToken.accountId, token: byToken.name };
    const session = store.sessionByToken(bearer, at);
    return session ? { accountId: session.accountId, token: null } : null;
  };

  /**
   * Sends a notice about `accountId`'s publishing, best effort: out of the notices' own share of the day's emails
   * (accounts.ts NOTICE_SHARE), the account's NOTICES_PER_ACCOUNT, and never once codes to new addresses stopped, so
   * publishing can't use up the emails for signing in. False when it didn't go out.
   */
  const notice = async (store: AccountStore, accountId: string, via: { mailer: Mailer; mailDailyLimit?: number }, message: Mail, at: number) => {
    const day = new Date(at).toISOString().slice(0, 10);
    const room = via.mailDailyLimit === undefined ? null : noticeRoom(via.mailDailyLimit);
    if (room && store.mailsSent(day) + 1 > room.ceiling) return false;
    if (!store.takeNotice(day, accountId, NOTICES_PER_ACCOUNT, room?.perDay ?? Number.POSITIVE_INFINITY)) return false;
    // Counted before the send, so sends at the same time see it; given back when it fails.
    store.countMail(day);
    try {
      await via.mailer.send(message);
      return true;
    } catch {
      store.uncountMail(day);
      // The account's notice too: one that didn't go is kept as unsent, and the next may still go (hunt 2026-11-25 E7).
      store.giveBackNotice(day, accountId);
      // Done all the same; the email is best effort.
      return false;
    }
  };

  /**
   * The developer hears of every publish, review and withdraw, within the notices' share (notice()). One that can't go out
   * is kept (AccountStore.recordUnsentNotice) and the app shows it in Publishing: on a busy day a mail can be skipped, and
   * the owner still sees what a stolen sign-in did.
   */
  const tellAccount = async (store: AccountStore, context: Context, accountId: string, kind: UnsentNotice["kind"], module: { id: string; name: string; version: string }, write: (to: string, language: MailLanguage) => Mail, at: number) => {
    const to = store.account(accountId)?.email;
    // An account without an address (Discord only) hears of nothing by mail: Publishing lists all of it instead.
    if (!to) {
      store.recordUnsentNotice(accountId, kind, module, at);
      return;
    }
    if (!mail) return;
    if (!(await notice(store, accountId, mail, write(to, languageOf(context)), at))) store.recordUnsentNotice(accountId, kind, module, at);
  };

  const moduleOf = (checked: CheckedZip) => ({ id: checked.manifest.id, name: checked.manifest.name, version: checked.manifest.version });

  const tellPublished = (store: AccountStore, context: Context, accountId: string, checked: CheckedZip, token: string | null, at: number) =>
    tellAccount(store, context, accountId, "published", moduleOf(checked), (to, language) => publishedMail(to, moduleOf(checked), checked.owner, token, language), at);

  const languageOf = (context: Context): MailLanguage => mailLanguage((context.req.header("accept-language") ?? "").slice(0, 2).toLowerCase());

  // A version that waits: the developer hears of it, and so does the maintainer. Best effort, like the published email.
  const tellWaiting = async (store: AccountStore, context: Context, accountId: string, checked: CheckedZip, reasons: ReviewReason[], at: number) => {
    if (!mail && !maintainer) return;
    const module = moduleOf(checked);
    const to = store.account(accountId)?.email;
    await tellAccount(store, context, accountId, "waiting", module, (address, language) => waitingMail(address, module, reasons, language), at);
    // The maintainer's notice counts against the account that uploaded, so it can't fill the maintainer's inbox either.
    if (maintainer) {
      const developer = store.developer(accountId)?.name ?? to ?? accountId;
      await notice(store, accountId, maintainer, waitingNoticeMail(maintainer.email, module, developer, reasons), at);
    }
  };

  /** Whether an account is the maintainer's own (MAINTAINER_EMAIL, any case). */
  const isMaintainer = (store: AccountStore, accountId: string) => {
    const email = store.account(accountId)?.email?.toLowerCase();
    return maintainer !== undefined && email !== undefined && email === maintainer.email.toLowerCase();
  };

  const handler = async (context: Context) => {
    const declared = Number(context.req.header("content-length"));
    if (Number.isSafeInteger(declared) && declared > ZIP_LIMITS.maxArchiveBytes) return tooBig(context);
    // The maintainer's own sign-in skips the hourly limit (decided 2026-10-29: the owner publishes without limits); who
    // signed in is known before the zip is read, so everyone else is still stopped before it.
    const signedIn = store ? uploader(store, context, now()) : null;
    if (!(store && signedIn && isMaintainer(store, signedIn.accountId))) {
      const wait = limiter.check(clientKey(context.req.raw));
      if (wait > 0) return tooMany(context, wait, "Too many uploads. Wait a while and try again.");
    }
    if (!catalog || !store) return refuse(context, 503, "unavailable", "Publishing is not available right now.");
    if ((context.req.header("content-type") ?? "").toLowerCase() !== "application/zip") return refuse(context, 415, "bad-request", "Send the zip as application/zip.");
    const by = signedIn;
    if (!by) {
      if (sentToken(context)) return refuse(context, 401, "sign-in-needed", TOKEN_GONE);
      return refuse(context, 401, "sign-in-needed", "Publishing needs your Tavora sign-in now: update tavora-pack and publish with Tavora open, or from CI with a publish token.");
    }
    // Nothing is read for an account that can't publish: without a linked key no upload of its can pass. A key it reported as
    // leaked may be unlinked by now, and that upload still gets its own answer below.
    if (store.keys(by.accountId).length === 0 && !store.hasLeakedReport(by.accountId)) return refuse(context, 403, "key-not-linked", "This publisher key is not linked to a Tavora account.");
    // One upload per account at a time; the maintainer ships as much as it needs (decided 2026-10-29), within the shared budget.
    const oneAtATime = !isMaintainer(store, by.accountId);
    if (oneAtATime && uploading.has(by.accountId)) return busy(context);
    // Room for the zip before it is read, so uploads at the same time can't add up past the service's memory.
    const room = Number.isSafeInteger(declared) && declared > 0 ? declared : ZIP_LIMITS.maxArchiveBytes;
    const ticket = memory.take(room);
    if (!ticket) return busy(context);
    if (oneAtATime) uploading.add(by.accountId);
    // A scan that was told to stop but hasn't yet still holds the zip and its files, so their memory stays counted until it has.
    const scans: Promise<void>[] = [];
    try {
      const read = await readUpload(context.req.raw, room, readLimits);
      if ("refused" in read) return read.refused === "too-big" ? tooBig(context) : refuse(context, 408, "invalid", "The upload took too long. Check your connection and try again.");
      // A short body was copied out of a big block (one without a Content-Length): that block goes before the ticket shrinks.
      if (room >= FREE_AFTER_BYTES && heldBytes(read.bytes) < room) freeMemory();
      return await accept(context, catalog, store, by, ticket, read.bytes, scans);
    } finally {
      if (oneAtATime) uploading.delete(by.accountId);
      // Once nothing refers to the zip any more, so the next upload doesn't start on top of this one's garbage.
      const big = ticket.held >= FREE_AFTER_BYTES;
      const done = () => {
        ticket.release();
        if (big) setImmediate(freeMemory);
      };
      if (scans.length === 0) done();
      else void Promise.all(scans).then(done);
    }
  };

  /** The upload, with memory held for it until it is answered. */
  const accept = async (context: Context, catalog: CatalogStore, store: AccountStore, by: { accountId: string; token: string | null }, ticket: MemoryTicket, bytes: Buffer, scans: Promise<void>[]) => {
    const signature = context.req.header("x-tavora-signature");
    // What unpacking will take, from the zip's directory. A directory that can't be read is refused just below, unpacking nothing.
    const plan = zipPlan(bytes);
    if (plan) {
      if (plan.needed > memory.budget) return refuse(context, 413, "too-big", "This module is too big for the catalog to check. Make it smaller.");
      if (plan.problem) return refuse(context, 400, "invalid", plan.problem);
      // Never less than the block behind the bytes (readUpload): a body shorter than its block may still be a view of it.
      if (!ticket.resize(plan.needed - bytes.length + heldBytes(bytes))) return busy(context);
      // Only the holder of a linked key gets a whole zip unpacked here.
      const early = signerKey(store, context, plan.signer!, sha256Hex(bytes), signature, by.accountId);
      if (early instanceof Response) return early;
    }

    let checked: CheckedZip;
    try {
      checked = checkCatalogZip(bytes, { official: officialOn(officialPins) });
      checkReleaseVersion(checked.manifest);
    } catch (error) {
      if (error instanceof CatalogError) return refuse(context, 400, "invalid", error.message);
      throw error;
    }
    const key = signerKey(store, context, checked.owner, checked.sha256, signature, by.accountId);
    if (key instanceof Response) return key;
    // A banned developer publishes nothing, with any of the account's keys, a sign-in or a token (decided 2026-10-26).
    // A suspended account publishes nothing either, until it is unsuspended (decided 2026-10-26).
    const barred = () => {
      if (store.isBanned(key.accountId) || store.isBannedKey(checked.owner)) return refuse(context, 403, "banned", "This account can't publish to the catalog any more. Check your email for why.");
      if (store.isSuspended(key.accountId) || store.isSuspended(by.accountId)) {
        return refuse(context, 403, "suspended", "This account is suspended and can't publish to the catalog. Check your email for why.");
      }
      return null;
    };
    const barredNow = barred();
    if (barredNow) return barredNow;
    if (catalog.isDeclined(checked.sha256)) return refuse(context, 403, "declined", "Tavora declined this exact zip. Fix the problem and publish a new version.");
    const trust = catalogTrust(catalog, catalogueKey);
    // The key's own state. Checked before the scan and again right after it, like bans: a key may be unlinked, revoked
    // or reported as leaked while the scan runs, and that's when an upload signed with it matters most.
    // The same check runs again when a waiting version is approved (moderation-admin.ts).
    const keyRefused = () => {
      const state = keyRefusal(store, trust, checked.owner, checked.sha256, key.accountId);
      if (state === "key-not-linked") return refuse(context, 403, "key-not-linked", "This publisher key is not linked to a Tavora account.");
      // Apps know to link a key that isn't linked, and linking it again wakes it, so it answers with that reason.
      if (state === "key-paused") return refuse(context, 403, "key-not-linked", PAUSED_KEY);
      if (state === "key-revoked") return refuse(context, 403, "key-revoked", "This publisher key was revoked and publishes nothing new. Link a new key to your account.");
      // Reported as leaked in the app: nothing new from it while the revocation waits to be signed.
      if (state === "key-leaked") return refuse(context, 403, "key-leaked", "You reported this publisher key as leaked, so it publishes nothing new. Publish with your new key.");
      return null;
    };
    const keyNow = keyRefused();
    if (keyNow) return keyNow;
    // A successor key counts for its account's first key only when the succession names this account.
    const firstKey = (fingerprint: string) => {
      const first = trust.firstKey(fingerprint);
      return first.account === key.accountId ? first.key : fingerprint;
    };

    // Tavora's own modules: only the pinned key (or its successor in the pinned account), uploaded with the pinned account's sign-in.
    // This comes before the prefix rules, so the prefix "tavora" is never reserved or checked for anyone.
    const official = isOfficialId(checked.manifest.id);
    if (official) {
      if (
        !trust.officialSigner(checked.owner, checked.sha256, officialPins) ||
        key.accountId !== officialPins.account ||
        by.accountId !== officialPins.account ||
        by.token !== null
      ) {
        return refuse(context, 400, "invalid", "Its id is reserved for Tavora's own modules, which stay bundled with the app.");
      }
      if (!checked.manifest.minTavora) return refuse(context, 400, "invalid", "A Tavora module names the oldest Tavora it needs (minTavora).");
    }

    // The same zip again from its own account: a client that lost the answer (it timed out during the scan) gets it now.
    // Nothing is added and nobody is emailed a second time.
    const answerBefore = () => {
      const before = catalog.uploadedBefore(checked.sha256, key.accountId);
      if (!before) return null;
      const answer = { id: checked.manifest.id, version: checked.manifest.version, sha256: checked.sha256 };
      if (before.status === "listed") return context.json({ status: "published", ...answer }, 201);
      return context.json({ status: "waiting", ...answer, reasons: before.reasons.map(({ check, text }) => ({ check, text })) }, 202);
    };
    const sentBefore = answerBefore();
    if (sentBefore) return sentBefore;

    const prefix = checked.manifest.id.split(".")[0]!;
    // Modules of the key this one succeeds count as the account's own, even once the lost key is unlinked.
    const succeeded = firstKey(checked.owner);
    const prefixState = () => (official ? "held" : store.prefixCheck(key.accountId, prefix, { ownersUnder: (under) => catalog.ownersUnder(under).filter((owner) => owner !== succeeded) }));
    const prefixRefusal = (state: ReturnType<typeof prefixState>) => {
      if (state === "taken") return refuse(context, 403, "prefix-taken", `The id prefix "${prefix}" belongs to another developer.`);
      if (state === "reserved") return refuse(context, 403, "prefix-reserved", `The id prefix "${prefix}" is reserved.`);
      if (state === "too-many") return refuse(context, 403, "too-many-prefixes", "Your account holds as many id prefixes as it can. Publish under one of them.");
      if (state === "free" && by.token !== null) {
        return refuse(context, 403, "token-new-prefix", `A publish token publishes only under your account's id prefixes. Publish the first module under "${prefix}" from Tavora.`);
      }
      return null;
    };
    const refused = prefixRefusal(prefixState());
    if (refused) return refused;

    const at = now();
    // The maintainer's own account (MAINTAINER_EMAIL) ships as often and as much as it needs: no hourly, daily, waiting
    // or account limit (decided 2026-10-29). The catalog's own size limit still holds, as it guards the server's disk.
    // Tavora's own account has none of the account limits either.
    const owner = official || isMaintainer(store, key.accountId);
    // Only a module's newest versions keep their zips, so what this version pushes out doesn't count against it.
    const id = checked.manifest.id;
    // The daily, waiting and storage limits. Checked before the scan and again right before the version is added.
    // Nothing in it is awaited, so the check after the scan and the adding of the version have nothing between them.
    // A version that lists now pushes an older zip out. One that waits frees it only once approved: the account's limit still
    // credits it, for one waiting version per module, so an update isn't refused for the zip it replaces. The catalog's own limit
    // guards the disk, so there only a version that lists now counts what it frees.
    let usedBytes = 0;
    const overLimit = (listsNow: boolean): LimitCheck => {
      const freedOnDisk = listsNow ? catalog.freedByNextVersion(id, keepVersions) : 0;
      const freedForAccount = listsNow || catalog.waitingCountOfModule(id) === 0 ? catalog.freedByNextVersion(id, keepVersions, key.accountId) : 0;
      if (!owner && catalog.uploadsSince(key.accountId, new Date(at - 86_400_000)) >= uploadsPerDay) {
        return refuse(context, 429, "daily-limit", `An account can publish ${uploadsPerDay} versions a day. Try again tomorrow.`);
      }
      if (!owner && catalog.waitingCount(key.accountId) >= waitingPerAccount) {
        return refuse(context, 429, "too-many-waiting", `${waitingPerAccount} of your versions are waiting for review already. Wait for them, or withdraw one.`);
      }
      if (!owner && catalog.storedBytes(key.accountId) - freedForAccount + checked.size > accountBytes) {
        return refuse(context, 413, "account-full", `Your modules may take at most ${accountBytes / 1024 / 1024} MB in the catalog.`);
      }
      usedBytes = catalog.storedBytes();
      if (usedBytes - freedOnDisk + checked.size > catalogBytes) {
        console.warn("[tavora-api] The module catalog is full: uploads are refused until there is room.");
        return { full: refuse(context, 507, "catalog-full", "The catalog has no room right now. Tavora has been told.") };
      }
      return null;
    };
    /** The refusal for a limit, or null; a full catalog also tells the maintainer. */
    const refusedByLimit = async () => {
      // Before the scan it may still list, so it gets the benefit of the doubt.
      const over = overLimit(true);
      if (!over) return null;
      if (over instanceof Response) return over;
      await tellFull(catalog, store, at, usedBytes);
      return over.full;
    };
    const overNow = await refusedByLimit();
    if (overNow) return overNow;
    // Before the scan, so a version that can't be added doesn't hold the shared memory through it.
    const conflict = catalog.versionConflict(checked, firstKey);
    if (conflict) return refuse(context, 409, "conflict", conflict);

    // The automatic checks. They never throw: one that cannot run is a reason to wait.
    // Tavora's own modules skip the first-module and new-picture rules; the other checks still run and are kept for the admin page.
    const subject = { accountId: key.accountId, fingerprints: store.keys(key.accountId).map((linked) => linked.fingerprint) };
    const checks = { catalog, scanner, scanLimitMs, holdWhileScanning: (stopped: Promise<void>) => scans.push(stopped) };
    const reasons = official ? await runChecks(checks, checked, bytes, subject) : await reviewUpload(checks, checked, bytes, subject);
    // The scan can take minutes, and the account may have been banned or suspended, or reached a limit, meanwhile; the
    // prefix may have changed hands too: another upload of this account may have taken its last free prefix, or another
    // account claimed this one. So all of it is checked again, and the prefix reserved, with nothing awaited before the
    // version is added, and a reservation made here goes again when the version isn't added.
    // A refusal from here on cost a whole scan, so it counts towards the daily limit like an upload that was added.
    const afterScan = (response: Response) => {
      catalog.countUpload(key.accountId, checked.sha256, new Date(at));
      return response;
    };
    const barredAfter = barred();
    if (barredAfter) return afterScan(barredAfter);
    const keyAfter = keyRefused();
    if (keyAfter) return afterScan(keyAfter);
    // The token or sign-in it came with may have ended while the zip came in and was checked (the token removed, its
    // device signed out, the email changed): nothing is published for it (audit 2026-11-22).
    const stillBy = uploader(store, context, now());
    if (!stillBy || stillBy.accountId !== by.accountId) return afterScan(refuse(context, 401, "sign-in-needed", by.token !== null ? TOKEN_GONE : "Sign in again to publish."));
    // The first try of a retry may have finished during this scan.
    const sentMeanwhile = answerBefore();
    if (sentMeanwhile) return sentMeanwhile;
    // A taken-down module's version never goes live on its own, whatever the checks say.
    const takenDown = catalog.isTakenDown(id);
    if (takenDown) reasons.push(TAKEN_DOWN);
    const listsNow = !takenDown && (official || reasons.length === 0);
    const overAfter = overLimit(listsNow);
    if (overAfter instanceof Response) return afterScan(overAfter);
    if (overAfter) {
      await tellFull(catalog, store, at, usedBytes);
      return afterScan(overAfter.full);
    }
    const held = prefixState();
    const refusedNow = prefixRefusal(held);
    if (refusedNow) return afterScan(refusedNow);
    if (held === "free") store.reservePrefix(key.accountId, prefix, at);
    try {
      catalog.add(bytes, new Date(at), key.accountId, checked, firstKey, { reasons, language: languageOf(context), token: by.token, ...(official && !takenDown ? { official: true } : {}) });
    } catch (error) {
      if (held === "free") store.releasePrefix(key.accountId, prefix);
      if (error instanceof CatalogError) return afterScan(refuse(context, 409, "conflict", error.message));
      throw error;
    }
    // It fit, whether it lists now or waits.
    catalog.clearFull();
    if (!listsNow) {
      await tellWaiting(store, context, key.accountId, checked, reasons, at);
      return context.json(
        { status: "waiting", id: checked.manifest.id, version: checked.manifest.version, sha256: checked.sha256, reasons: reasons.map(({ check, text }) => ({ check, text })) },
        202,
      );
    }
    catalog.prune(id, keepVersions, new Date(at));
    await tellPublished(store, context, key.accountId, checked, by.token, at);
    return context.json({ status: "published", id: checked.manifest.id, version: checked.manifest.version, sha256: checked.sha256 }, 201);
  };

  /** The signed-in account's versions waiting for review, with their reasons. */
  const waiting = (context: Context) => {
    const wait = waitingLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait, "Too many requests. Wait a while and try again.");
    if (!catalog || !store) return refuse(context, 503, "unavailable", "Publishing is not available right now.");
    const by = uploader(store, context, now());
    if (!by) return refuse(context, 401, "sign-in-needed", sentToken(context) ? TOKEN_GONE : "Sign in to see your versions.");
    const stopped = stoppedAccount(store, by.accountId, context);
    if (stopped) return stopped;
    return context.json({
      waiting: catalog
        .waitingVersions()
        .filter((version) => version.accountId === by.accountId)
        .map((version) => ({ id: version.id, version: version.version, sha256: version.sha256, queuedAt: version.queuedAt, reasons: version.review.reasons.map(({ check, text }) => ({ check, text })) })),
    });
  };

  /** Takes one of the account's waiting versions back: its row and zip go. Only the account that uploaded it can. */
  const withdraw = async (context: Context) => {
    const wait = waitingLimiter.check(clientKey(context.req.raw));
    if (wait > 0) return tooMany(context, wait, "Too many requests. Wait a while and try again.");
    if (!catalog || !store) return refuse(context, 503, "unavailable", "Publishing is not available right now.");
    const by = uploader(store, context, now());
    if (!by) return refuse(context, 401, "sign-in-needed", sentToken(context) ? TOKEN_GONE : "Sign in to withdraw a version.");
    // A banned or suspended developer can't take a waiting version back and so remove what the maintainer is about to judge.
    const stopped = stoppedAccount(store, by.accountId, context);
    if (stopped) return stopped;
    const sha256 = context.req.param("sha256") ?? "";
    const version = /^[0-9a-f]{64}$/.test(sha256) ? catalog.waitingVersion(sha256) : null;
    if (!version || version.accountId !== by.accountId) return refuse(context, 404, "not-waiting", "No version of yours with this hash is waiting for review.");
    catalog.removeWaiting(sha256);
    // Like a publish, the account hears of it, so a withdraw with a stolen publish token doesn't go unnoticed.
    const module = { id: version.id, name: version.manifest.name, version: version.version };
    await tellAccount(store, context, by.accountId, "withdrawn", module, (to, language) => withdrawnMail(to, module, by.token, language), now());
    return context.json({ status: "withdrawn", id: version.id, version: version.version, sha256 });
  };

  return { handler, waiting, withdraw };
}
