import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";

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
const app = createApp({
  db,
  clientKey: (request) =>
    (behindProxy ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined) || "shared",
});

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`[tavora-api] listening on http://127.0.0.1:${info.port}`);
});
