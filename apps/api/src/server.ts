import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadIconStore } from "./icons.ts";
import { createSteamClient } from "./steam.ts";

const port = Number(process.env.PORT ?? 4010);
const path = process.env.TAVORA_GAMES_DB ?? "data/games.sqlite";
// Behind Caddy the client is the first address of X-Forwarded-For; without a
// proxy the header could be forged, so it is only read when asked for.
const behindProxy = process.env.TRUST_PROXY === "1";

if (!existsSync(path)) {
  console.error(`[tavora-api] No dataset at ${path}. Build one with: pnpm --filter @tavora/api dataset`);
  process.exit(1);
}

const db = new DatabaseSync(path, { readOnly: true });
// Without a key the Steam import answers 503; search never needs one.
const steamKey = process.env.STEAM_WEB_API_KEY?.trim();
if (!steamKey) console.log("[tavora-api] No STEAM_WEB_API_KEY: Steam import is off.");
// Hosted game icons are only served with a takedown contact; without one the icon routes answer 503.
const takedownContact = process.env.TAKEDOWN_CONTACT?.trim();
if (!takedownContact) console.log("[tavora-api] No TAKEDOWN_CONTACT: hosted icons are off.");
const icons = loadIconStore(process.env.TAVORA_ICONS_DIR ?? "data/icons", (message) => console.warn(`[tavora-api] ${message}`));
console.log(`[tavora-api] ${icons.list().length} hosted icons loaded.`);
const app = createApp({
  db,
  icons,
  ...(takedownContact ? { takedownContact } : {}),
  ...(steamKey ? { steam: createSteamClient({ key: steamKey }) } : {}),
  clientKey: (request) =>
    (behindProxy ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined) || "shared",
});

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`[tavora-api] listening on http://127.0.0.1:${info.port}`);
});
