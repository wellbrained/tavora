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
import { collectWikidata, type WikidataRow } from "../src/wikidata-rows.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databasePath = resolve(root, "data/games.sqlite");
const registryPath = resolve(root, "data/ids.tsv");
const USER_AGENT = "TavoraGameDataset/0.1 (https://mytavora.app; open-source game companion)";

const args = process.argv.slice(2);
const limitIndex = args.indexOf("--limit");
const rowLimit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : undefined;

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Wikidata was busy (429, 5xx or no answer) even after the retries. */
class WikidataBusy extends Error {}

// Wikidata's query service often times out or turns requests away for a moment, so a
// busy answer is asked again a few times, after Retry-After or a growing pause.
async function sparql(query: string): Promise<{ results: { bindings: Record<string, { value: string }>[] } }> {
  for (let attempt = 1; ; attempt++) {
    let status = 0;
    let retryAfter = 0;
    try {
      const response = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" },
      });
      if (response.ok) return (await response.json()) as never;
      status = response.status;
      retryAfter = Number(response.headers.get("retry-after")) || 0;
      await response.body?.cancel();
      if (status !== 429 && status < 500) throw new Error(`Wikidata answered ${status}`);
    } catch (error) {
      if (status && status !== 429 && status < 500) throw error;
    }
    if (attempt === 4) throw new WikidataBusy(`Wikidata answered ${status || "nothing"}`);
    const pause = Math.max(retryAfter * 1000, 5000 * 2 ** (attempt - 1));
    console.log(`Wikidata answered ${status || "nothing"}; trying again in ${pause / 1000} s`);
    await wait(pause);
  }
}

// Video games (and their subclasses) with a Steam application ID (P1733), in
// ranges of appids so no single query runs long.
async function fetchWikidata(): Promise<WikidataGame[]> {
  const byItem = new Map<string, WikidataGame>();
  const langs = new Map<string, string>();
  // Ranges still to ask, lowest first. A range Wikidata keeps failing on is split in two.
  const ranges: [number, number][] = [];
  for (let from = 0; from < 5_000_000; from += 250_000) ranges.push([from, from + 250_000]);
  while (ranges.length) {
    const [from, to] = ranges.shift()!;
    const remaining = rowLimit === undefined ? undefined : rowLimit - byItem.size;
    if (remaining !== undefined && remaining <= 0) break;
    const query = `
      SELECT ?item ?label ?lang ?appid (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?alts) WHERE {
        ?item wdt:P31/wdt:P279* wd:Q7889 ; wdt:P1733 ?appid ; rdfs:label ?label .
        BIND(LANG(?label) AS ?lang)
        FILTER(?lang IN ("en", "mul"))
        FILTER(xsd:integer(?appid) >= ${from} && xsd:integer(?appid) < ${to})
        OPTIONAL { ?item skos:altLabel ?alt . FILTER(LANG(?alt) IN ("en", "mul")) }
      } GROUP BY ?item ?label ?lang ?appid ${remaining !== undefined ? `LIMIT ${remaining}` : ""}`;
    let results;
    try {
      ({ results } = await sparql(query));
    } catch (error) {
      if (!(error instanceof WikidataBusy) || to - from <= 10_000) throw error;
      const middle = from + Math.floor((to - from) / 2);
      console.log(`Wikidata: appids ${from} to ${to} keep failing; asking in two halves`);
      ranges.unshift([from, middle], [middle, to]);
      continue;
    }
    collectWikidata(results.bindings as unknown as WikidataRow[], byItem, langs);
    console.log(`Wikidata: appids below ${to}: ${byItem.size} games so far`);
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
