import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { serve } from "@hono/node-server";
import { AccountStore } from "./account-store.ts";
import { CatalogStore } from "./catalog.ts";
import { CopyStore } from "./cloud-copy.ts";
import { createAdminApp } from "./admin-app.ts";
import { ActivityLog } from "./activity-log.ts";
import { createDiscordClient } from "./discord.ts";
import { createApp } from "./app.ts";
import { githubInstallerTotals } from "./github-releases.ts";
import { createHostedStore } from "./hosted-store.ts";
import { IconState } from "./icon-state.ts";
import { normalize } from "./ids.ts";
import { loadIconStore } from "./icons.ts";
import { createBrevoMailer, createTestInbox, createTestInboxApp, type Mailer } from "./mail.ts";
import { clientOf } from "./rate-limit.ts";
import { StatsStore } from "./stats.ts";
import { ReviewStore } from "./reviews.ts";
import { ConversationStore } from "./conversations.ts";
import { LeaderboardStore } from "./leaderboards.ts";
import { createSteamClient } from "./steam.ts";
import { createSubmissions } from "./submissions.ts";
import { scannerFromEnv } from "./virus-scan.ts";

const port = Number(process.env.PORT ?? 4010);
const datasetPath = process.env.TAVORA_GAMES_DB ?? "data/games.sqlite";
// Behind Caddy the client is the first address of X-Forwarded-For; without a
// proxy the header could be forged, so it is only read when asked for.
const behindProxy = process.env.TRUST_PROXY === "1";

if (!existsSync(datasetPath)) {
  console.error(`[tavora-api] No dataset at ${datasetPath}. Build one with: pnpm --filter @tavora/api dataset`);
  process.exit(1);
}

const db = new DatabaseSync(datasetPath, { readOnly: true });
// Without a key the Steam import answers 503; search never needs one.
const steamKey = process.env.STEAM_WEB_API_KEY?.trim();
if (!steamKey) console.log("[tavora-api] No STEAM_WEB_API_KEY: Steam import is off.");
// Hosted game icons are only served with a takedown contact; without one the icon routes answer 503.
const takedownContact = process.env.TAKEDOWN_CONTACT?.trim();
if (!takedownContact) console.log("[tavora-api] No TAKEDOWN_CONTACT: hosted icons are off.");
// Who hears by email when the module catalog is full; without it only the admin page shows it.
const maintainerEmail = process.env.MAINTAINER_EMAIL?.trim();

// The one writable thing: icons offered by users, approved ones and takedowns.
const stateDir = process.env.TAVORA_STATE_DIR ?? "data/state";
mkdirSync(stateDir, { recursive: true });
const state = new IconState(path.join(stateDir, "icons.sqlite"));
const releaseIcons = loadIconStore(process.env.TAVORA_ICONS_DIR ?? "data/icons", (message) => console.warn(`[tavora-api] ${message}`));
const icons = createHostedStore(releaseIcons, state);
console.log(`[tavora-api] ${icons.list().length} hosted icons, ${state.pendingCount()} waiting for review.`);

const gameNameStatement = db.prepare("select name from games where id = ?");
const gamesNamedStatement = db.prepare("select distinct game_id from entries where norm = ?");
const submissions = createSubmissions({
  state,
  store: icons,
  gameName: (id) => (gameNameStatement.get(id) as { name: string } | undefined)?.name ?? null,
  gamesNamed: (name) => (gamesNamedStatement.all(normalize(name)) as { game_id: string }[]).map((row) => row.game_id),
});

// Accounts need a way to send email. No provider is set up yet (it is chosen
// before accounts go live); for development, TAVORA_TEST_INBOX_PORT keeps the
// mail in memory and shows it on a local page. Never in production.
let mailer: Mailer | undefined;
let testInbox = false;
const inboxPort = process.env.TAVORA_TEST_INBOX_PORT?.trim();
if (inboxPort && process.env.NODE_ENV === "production") {
  console.warn("[tavora-api] TAVORA_TEST_INBOX_PORT is ignored in production.");
} else if (inboxPort) {
  const inbox = createTestInbox();
  mailer = inbox;
  testInbox = true;
  serve({ fetch: createTestInboxApp(inbox).fetch, port: Number(inboxPort), hostname: "127.0.0.1" }, (info) => {
    console.log(`[tavora-api] test inbox on http://127.0.0.1:${info.port} (local only, mail is never sent)`);
  });
}
// Production: Brevo, when its key is in production.env (tavora-api-set-setting brevo-key).
let mailDailyLimit: number | undefined;
const brevoKey = process.env.BREVO_API_KEY?.trim();
if (!mailer && brevoKey) {
  const from = process.env.MAIL_FROM?.trim() || "signin@mytavora.app";
  mailer = createBrevoMailer({ apiKey: brevoKey, from });
  const limit = Number(process.env.MAIL_DAILY_LIMIT ?? 300);
  mailDailyLimit = Number.isInteger(limit) && limit > 0 ? limit : 300;
  console.log(`[tavora-api] Accounts are on: email through Brevo from ${from}, at most ${mailDailyLimit} a day.`);
}
if (!mailer) console.log("[tavora-api] No way to send email: accounts are off.");
const accountStore = mailer ? new AccountStore(path.join(stateDir, "accounts.sqlite")) : undefined;
// The cloud copies: their own file, which the daily backup leaves out (decided 2026-10-19; the PCs upload again).
const copies = accountStore ? new CopyStore(path.join(stateDir, "copies.sqlite")) : undefined;
// The module catalog, read-only here: modules are added by hand with catalog.mjs (scripts/catalog.ts).
const catalog = new CatalogStore(path.join(stateDir, "catalog"));
// Ratings and reviews of catalog modules, keyed by account: their own file, in the daily backup.
const reviews = accountStore ? new ReviewStore(path.join(stateDir, "reviews.sqlite")) : undefined;
// Conversations between users and developers, and with Tavora (conversations.ts): their own file, in the daily backup.
const conversations = accountStore ? new ConversationStore(path.join(stateDir, "conversations.sqlite")) : undefined;
if (conversations) {
  // Idle conversations close after 30 days and closed ones go after 180 (unless reported); once an hour is plenty.
  const sweepConversations = () => conversations.sweep(Date.now());
  sweepConversations();
  setInterval(sweepConversations, 60 * 60_000).unref();
}
// Leaderboards (leaderboards.ts): their own file, in the daily backup.
const leaderboards = accountStore ? new LeaderboardStore(path.join(stateDir, "leaderboards.sqlite")) : undefined;
console.log(`[tavora-api] ${catalog.index().length} modules in the catalog.`);
// Plain daily totals (stats.ts): nothing about a user. Once a day the account numbers are written down too.
const stats = new StatsStore(path.join(stateDir, "stats.sqlite"));
const activity = new ActivityLog(path.join(stateDir, "activity.sqlite"));
const snapshotAccounts = () => {
  if (accountStore && !stats.hasSnapshot()) stats.snapshotAccounts(accountStore.activity(Date.now()));
};
snapshotAccounts();
setInterval(snapshotAccounts, 60 * 60_000).unref();
// Installers downloaded from the GitHub releases: GitHub's running totals, once an hour (github-releases.ts).
const countGithubDownloads = () =>
  githubInstallerTotals()
    .then((totals) => stats.countGithubTotals(totals))
    .catch((error: unknown) => console.error(`[tavora-api] Can't read the GitHub downloads: ${error instanceof Error ? error.message : "unknown error"}`));
void countGithubDownloads();
setInterval(() => void countGithubDownloads(), 60 * 60_000).unref();

// The virus scan every new catalog version goes through (ClamAV). Without one, or when it fails, every new version waits for review.
const scanner = scannerFromEnv(process.env);
console.log(scanner ? "[tavora-api] Virus scan for new catalog versions: on." : "[tavora-api] No CLAMD_SOCKET, CLAMD_HOST or CLAMSCAN_PATH: every new catalog version waits for review.");

let testRequests = 0;
const app = createApp({
  db,
  ...(scanner ? { scanner } : {}),
  icons,
  submissions,
  catalog,
  stats,
  ...(mailer && accountStore
    ? {
        accounts: {
          store: accountStore,
          mailer,
          ...(copies ? { copies } : {}),
          ...(reviews ? { reviews } : {}),
          ...(conversations ? { conversations } : {}),
          ...(leaderboards ? { leaderboards } : {}),
          ...(mailDailyLimit === undefined ? {} : { mailDailyLimit }),
          // Discord login: Tavora's public Discord app, no secret; DISCORD_API only for a pretend Discord in tests.
          discord: createDiscordClient(process.env.DISCORD_API ? { api: process.env.DISCORD_API } : {}),
        },
      }
    : {}),
  ...(takedownContact ? { takedownContact } : {}),
  ...(maintainerEmail ? { maintainerEmail } : {}),
  ...(steamKey ? { steam: createSteamClient({ key: steamKey }) } : {}),
  // An IPv6 client counts by its /64 (clientOf), so new addresses from one connection share one limit.
  // With the local test inbox every request counts as its own client: the e2e suite runs many PCs from one
  // address for minutes, and the per-client limits would cut it off part way. Unit tests cover the limits.
  clientKey: testInbox ? () => `test-${testRequests++}` : (request) => (behindProxy ? clientOf(request.headers.get("x-forwarded-for")?.split(",")[0]) : null) ?? "shared",
});

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`[tavora-api] listening on http://127.0.0.1:${info.port}`);
});

// Tavora Admin (the review page and more): its own port of 127.0.0.1 that the web server never forwards, and a token.
const adminToken = process.env.ADMIN_TOKEN?.trim();
if (adminToken && adminToken.length >= 24) {
  const adminPort = Number(process.env.ADMIN_PORT ?? 4011);
  const meta = () => Object.fromEntries((db.prepare("select key, value from meta").all() as unknown as { key: string; value: string }[]).map(({ key, value }) => [key, value]));
  const admin = createAdminApp({
    token: adminToken,
    submissions,
    state,
    store: icons,
    catalog,
    ...(accountStore ? { accounts: accountStore } : {}),
    ...(reviews ? { reviews } : {}),
    ...(conversations ? { conversations } : {}),
    ...(leaderboards ? { leaderboards } : {}),
    ...(copies ? { copies } : {}),
    // The built panel: deployed from wellbrained/tavora-admin to /srv/tavora-admin/current; in development
    // the tavora-admin checkout next to this repo.
    adminDir: process.env.TAVORA_ADMIN_DIR ?? "../../../tavora-admin/dist",
    dataset: () => ({ games: Number(meta().games ?? 0), builtAt: meta().built_at ?? null }),
    ...(mailDailyLimit === undefined ? {} : { mailDailyLimit }),
    stateDir,
    stats,
    activity,
    ...(maintainerEmail ? { ownerEmail: maintainerEmail } : {}),
    moderation: { ...(scanner ? { scanner } : {}), ...(mailer ? { mailer } : {}), mailDailyLimit },
  });
  serve({ fetch: admin.fetch, port: adminPort, hostname: "127.0.0.1" }, (info) => {
    console.log(`[tavora-api] Tavora Admin on http://127.0.0.1:${info.port} (local only)`);
  });
} else {
  console.log("[tavora-api] No ADMIN_TOKEN of at least 24 characters: Tavora Admin is off, and nothing offered can be approved.");
}
