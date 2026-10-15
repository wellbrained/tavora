import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { serve } from "@hono/node-server";
import { createAdminApp } from "./admin-app.ts";
import { createApp } from "./app.ts";
import { createHostedStore } from "./hosted-store.ts";
import { IconState } from "./icon-state.ts";
import { loadIconStore } from "./icons.ts";
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

// The one writable thing: icons offered by players, approved ones and takedowns.
const stateDir = process.env.TAVORA_STATE_DIR ?? "data/state";
mkdirSync(stateDir, { recursive: true });
const state = new IconState(path.join(stateDir, "icons.sqlite"));
const releaseIcons = loadIconStore(process.env.TAVORA_ICONS_DIR ?? "data/icons", (message) => console.warn(`[tavora-api] ${message}`));
const icons = createHostedStore(releaseIcons, state);
console.log(`[tavora-api] ${icons.list().length} hosted icons, ${state.pendingCount()} waiting for review.`);

const gameNameStatement = db.prepare("select name from games where id = ?");
const submissions = createSubmissions({
  state,
  store: icons,
  gameName: (id) => (gameNameStatement.get(id) as { name: string } | undefined)?.name ?? null,
});

const app = createApp({
  db,
  icons,
  submissions,
  ...(takedownContact ? { takedownContact } : {}),
  ...(steamKey ? { steam: createSteamClient({ key: steamKey }) } : {}),
  clientKey: (request) =>
    (behindProxy ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined) || "shared",
});

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`[tavora-api] listening on http://127.0.0.1:${info.port}`);
});

// The review page: its own port of 127.0.0.1 that the web server never forwards, and a token.
const adminToken = process.env.ADMIN_TOKEN?.trim();
if (adminToken && adminToken.length >= 24) {
  const adminPort = Number(process.env.ADMIN_PORT ?? 4011);
  serve({ fetch: createAdminApp({ token: adminToken, submissions, state, store: icons }).fetch, port: adminPort, hostname: "127.0.0.1" }, (info) => {
    console.log(`[tavora-api] review page on http://127.0.0.1:${info.port} (local only)`);
  });
} else {
  console.log("[tavora-api] No ADMIN_TOKEN of at least 24 characters: the review page is off, and nothing offered can be approved.");
}
