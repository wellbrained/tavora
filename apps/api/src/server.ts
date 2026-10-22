import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { serve } from "@hono/node-server";
import { AccountStore } from "./account-store.ts";
import { CatalogStore } from "./catalog.ts";
import { CopyStore } from "./cloud-copy.ts";
import { createAdminApp } from "./admin-app.ts";
import { createDiscordClient } from "./discord.ts";
import { createApp } from "./app.ts";
import { createHostedStore } from "./hosted-store.ts";
import { IconState } from "./icon-state.ts";
import { normalize } from "./ids.ts";
import { loadIconStore } from "./icons.ts";
import { createBrevoMailer, createTestInbox, createTestInboxApp, type Mailer } from "./mail.ts";
import { clientOf } from "./rate-limit.ts";
import { ReviewStore } from "./reviews.ts";
import { createSteamClient } from "./steam.ts";
import { createSubmissions } from "./submissions.ts";

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

// The one writable thing: icons offered by players, approved ones and takedowns.
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
console.log(`[tavora-api] ${catalog.index().length} modules in the catalog.`);

let testRequests = 0;
const app = createApp({
  db,
  icons,
  submissions,
  catalog,
  ...(mailer && accountStore
    ? {
        accounts: {
          store: accountStore,
          mailer,
          ...(copies ? { copies } : {}),
          ...(reviews ? { reviews } : {}),
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

// The review page: its own port of 127.0.0.1 that the web server never forwards, and a token.
const adminToken = process.env.ADMIN_TOKEN?.trim();
if (adminToken && adminToken.length >= 24) {
  const adminPort = Number(process.env.ADMIN_PORT ?? 4011);
  serve({ fetch: createAdminApp({ token: adminToken, submissions, state, store: icons, catalog, ...(accountStore ? { accounts: accountStore } : {}), ...(reviews ? { reviews } : {}) }).fetch, port: adminPort, hostname: "127.0.0.1" }, (info) => {
    console.log(`[tavora-api] review page on http://127.0.0.1:${info.port} (local only)`);
  });
} else {
  console.log("[tavora-api] No ADMIN_TOKEN of at least 24 characters: the review page is off, and nothing offered can be approved.");
}
