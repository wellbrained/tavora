// Builds data/games.sqlite from Wikidata (CC0), Steam's public app list and the
// app's built-in games, and updates data/ids.tsv, the registry that keeps ids
// frozen. Run on a PC, never on the server:
//
//   pnpm --filter @tavora/api dataset [--limit <wikidata rows>] [--no-wikidata]
//
// STEAM_WEB_API_KEY (optional) adds Steam's list of games Wikidata lacks.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG } from "../../desktop/src/main/catalog.ts";
import { buildDataset, emptyRegistry, registryOf, writeDatabase, type SteamApp, type WikidataGame } from "../src/dataset.ts";
import { formatRegistry, parseRegistry } from "../src/registry-file.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databasePath = resolve(root, "data/games.sqlite");
const registryPath = resolve(root, "data/ids.tsv");
const USER_AGENT = "TavoraGameDataset/0.1 (https://mytavora.app; open-source game companion)";

const args = process.argv.slice(2);
const limitIndex = args.indexOf("--limit");
const rowLimit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : undefined;

async function sparql(query: string): Promise<{ results: { bindings: Record<string, { value: string }>[] } }> {
  const response = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" },
  });
  if (!response.ok) throw new Error(`Wikidata answered ${response.status}`);
  return (await response.json()) as never;
}

// Video games (and their subclasses) with a Steam application ID (P1733), in
// ranges of appids so no single query runs long.
async function fetchWikidata(): Promise<WikidataGame[]> {
  const byItem = new Map<string, WikidataGame>();
  const width = 250_000;
  for (let from = 0; from < 5_000_000; from += width) {
    const remaining = rowLimit === undefined ? undefined : rowLimit - byItem.size;
    if (remaining !== undefined && remaining <= 0) break;
    const query = `
      SELECT ?item ?label ?appid (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?alts) WHERE {
        ?item wdt:P31/wdt:P279* wd:Q7889 ; wdt:P1733 ?appid ; rdfs:label ?label .
        FILTER(LANG(?label) = "en")
        FILTER(xsd:integer(?appid) >= ${from} && xsd:integer(?appid) < ${from + width})
        OPTIONAL { ?item skos:altLabel ?alt . FILTER(LANG(?alt) = "en") }
      } GROUP BY ?item ?label ?appid ${remaining !== undefined ? `LIMIT ${remaining}` : ""}`;
    const { results } = await sparql(query);
    for (const row of results.bindings) {
      const qid = row.item!.value.split("/").pop()!;
      const appid = Number(row.appid!.value);
      if (!Number.isInteger(appid) || byItem.has(qid)) continue;
      byItem.set(qid, {
        qid,
        label: row.label!.value,
        aliases: row.alts?.value ? row.alts.value.split("|") : [],
        steamAppId: appid,
      });
    }
    console.log(`Wikidata: appids below ${from + width}: ${byItem.size} games so far`);
  }
  return [...byItem.values()];
}

// Steam's current app list, games only. It needs a key, so this is optional.
async function fetchSteam(key: string): Promise<SteamApp[]> {
  const apps: SteamApp[] = [];
  let last = 0;
  for (;;) {
    const url = new URL("https://api.steampowered.com/IStoreService/GetAppList/v1/");
    url.search = new URLSearchParams({
      key,
      include_games: "true",
      include_dlc: "false",
      include_software: "false",
      include_videos: "false",
      include_hardware: "false",
      max_results: "50000",
      last_appid: String(last),
    }).toString();
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) throw new Error(`Steam answered ${response.status}`);
    const { response: body } = (await response.json()) as {
      response: { apps?: SteamApp[]; have_more_results?: boolean; last_appid?: number };
    };
    for (const app of body.apps ?? []) if (app.name?.trim()) apps.push({ appid: app.appid, name: app.name.trim() });
    console.log(`Steam: ${apps.length} games so far`);
    if (!body.have_more_results || !body.last_appid) break;
    last = body.last_appid;
  }
  return apps;
}

const registry = existsSync(registryPath) ? parseRegistry(readFileSync(registryPath, "utf8")) : emptyRegistry();
const wikidata = args.includes("--no-wikidata") ? [] : await fetchWikidata();
const steamKey = process.env.STEAM_WEB_API_KEY;
const steam = steamKey ? await fetchSteam(steamKey) : [];
if (!steamKey) console.log("No STEAM_WEB_API_KEY: only Wikidata and the built-in games.");

const games = buildDataset({ builtIns: CATALOG, wikidata, steam, registry });

mkdirSync(dirname(databasePath), { recursive: true });
const temporary = `${databasePath}.tmp`;
rmSync(temporary, { force: true });
writeDatabase(temporary, games).close();
renameSync(temporary, databasePath);
writeFileSync(registryPath, formatRegistry(registryOf(games, registry)));
console.log(`Wrote ${games.length} games to ${databasePath} and updated ${registryPath}.`);
