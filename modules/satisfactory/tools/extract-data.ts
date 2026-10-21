// Extracts the module's game data and icons from a local Satisfactory install.
//
// pnpm --filter @tavora/satisfactory extract-data <game folder> --oodle <oo2core_9_win64.dll> [--dotnet <dotnet>] [--accept]
//
// Reads CommunityResources/Docs (en-US.json, de.json), the Steam app manifest for the build id and
// Engine/Binaries/Win64/*-Win64-Shipping.version for the game version. The asset exporter
// (tools/asset-export, .NET 10 with CUE4Parse) reads the icons and the MAM research trees from the
// IoStore archives; it needs an Oodle core library (oo2core_9_win64.dll) to decompress them.
//
// Writes src/data/game-data.json and public/icons/<Id>.webp. When the pinned data exists, new or
// missing items, recipes and buildings stop the run unless --accept is given; nothing is written then.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { GameData } from "../src/contracts/data";
import { compareIds, decodeDocs, DocsError, finish, iconRequests, readDocs, serialize, type ResearchTree } from "./game-docs.ts";
import { patchUsmap } from "./usmap.ts";

const STEAM_APP_ID = 526870;
const ICON_SIZE = 128;
const CULTURES = { en: "en-US", de: "de" } as const;

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = path.join(moduleRoot, "src", "data", "game-data.json");
const iconDir = path.join(moduleRoot, "public", "icons");

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    oodle: { type: "string" },
    dotnet: { type: "string", default: "dotnet" },
    build: { type: "string" },
    accept: { type: "boolean", default: false },
  },
});
const game = positionals[0];
if (!game || positionals.length > 1) fail("Pass the Satisfactory install folder, such as …/steamapps/common/Satisfactory.");
if (!options.oodle || !existsSync(options.oodle)) fail("Pass --oodle with the path of an Oodle core library (oo2core_9_win64.dll).");

try {
  const docs = path.join(game, "CommunityResources", "Docs");
  const catalog = readDocs(
    decodeDocs(readFileSync(path.join(docs, `${CULTURES.en}.json`))),
    decodeDocs(readFileSync(path.join(docs, `${CULTURES.de}.json`))),
  );
  const build = options.build ? Number(options.build) : steamBuild(game);
  const version = gameVersion(game);

  const work = mkdtempSync(path.join(tmpdir(), "tavora-satisfactory-"));
  process.on("exit", () => rmSync(work, { recursive: true, force: true }));
  const staged = path.join(work, "icons");
  const assets = exportAssets(game, work, staged, iconRequests(catalog));
  const icons = new Set(Object.entries(assets.icons).filter(([, error]) => error === "").map(([id]) => id));
  const failed = Object.entries(assets.icons).filter(([, error]) => error !== "");
  const report = finish(catalog, { build, version, researchTrees: assets.researchTrees, icons });
  const data = report.data;

  if (existsSync(dataFile)) {
    const changes = compareIds(JSON.parse(readFileSync(dataFile, "utf8")) as GameData, data);
    if (changes.length > 0 && !options.accept) {
      fail(`The game data changed since it was pinned. Check the list, then run again with --accept:\n- ${changes.join("\n- ")}`);
    }
    for (const change of changes) console.log(`Accepted: ${change}`);
  }

  const json = serialize(data);
  writeFileSync(dataFile, json);
  rmSync(iconDir, { recursive: true, force: true });
  mkdirSync(iconDir, { recursive: true });
  cpSync(staged, iconDir, { recursive: true });

  console.log(`Game ${version}, Steam build ${build}.`);
  console.log(
    `${Object.keys(data.items).length} items, ${Object.keys(data.recipes).length} recipes, ` +
      `${Object.keys(data.buildings).length} buildings, ${data.resources.length} resources, ` +
      `${Object.keys(data.defaultRecipe).length} default recipes; ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB.`,
  );
  console.log(`${icons.size} icons at ${ICON_SIZE} px in public/icons.`);
  for (const [id, error] of failed) console.warn(`No icon for ${id}: ${error}`);
  if (report.unreachableResearch.length > 0) {
    console.log(`Left out as unlocks, in no research tree: ${report.unreachableResearch.join(", ")}.`);
  }
} catch (error) {
  fail(error instanceof DocsError ? error.message : String((error as Error).stack ?? error));
}

function steamBuild(install: string): number {
  const manifest = path.resolve(install, "..", "..", `appmanifest_${STEAM_APP_ID}.acf`);
  const build = existsSync(manifest) ? /"buildid"\s+"(\d+)"/.exec(readFileSync(manifest, "utf8"))?.[1] : undefined;
  if (!build) fail(`No Steam build id in ${manifest}. Pass --build <id> for other stores.`);
  return Number(build);
}

function gameVersion(install: string): string {
  const binaries = path.join(install, "Engine", "Binaries", "Win64");
  const files = existsSync(binaries) ? readdirSync(binaries).filter((f) => f.endsWith("-Win64-Shipping.version")) : [];
  const versions = new Set(
    files.map((f) => (JSON.parse(readFileSync(path.join(binaries, f), "utf8")) as { GameVersion?: string }).GameVersion),
  );
  const [version] = versions;
  if (versions.size !== 1 || !version) fail(`No single GameVersion in ${binaries}/*-Win64-Shipping.version.`);
  return version;
}

interface AssetResult {
  icons: Record<string, string>;
  researchTrees: ResearchTree[];
}

function exportAssets(install: string, work: string, staged: string, icons: { id: string; texture: string }[]): AssetResult {
  const usmap = path.join(work, "FactoryGame.usmap");
  const patched = patchUsmap(readFileSync(path.join(install, "CommunityResources", "FactoryGame.usmap")));
  writeFileSync(usmap, patched.bytes);
  const job = path.join(work, "job.json");
  const result = path.join(work, "result.json");
  writeFileSync(
    job,
    JSON.stringify({
      paks: path.join(install, "FactoryGame", "Content", "Paks"),
      usmap,
      oodle: path.resolve(options.oodle!),
      iconDir: staged,
      iconSize: ICON_SIZE,
      icons,
      cultures: Object.values(CULTURES),
      result,
    }),
  );
  const project = path.join(moduleRoot, "tools", "asset-export");
  // Build output goes to the temp folder, never into the repository.
  const artifacts = path.join(tmpdir(), "tavora-satisfactory-asset-export");
  const run = spawnSync(
    options.dotnet!,
    ["run", "--project", project, "--configuration", "Release", "--artifacts-path", artifacts, "--", job],
    { stdio: "inherit", env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" } },
  );
  if (run.error) fail(`Could not start ${options.dotnet}: ${run.error.message}. Install the .NET 10 SDK or pass --dotnet.`);
  if (run.status !== 0) fail(`The asset exporter failed (exit ${run.status}).`);
  const output = JSON.parse(readFileSync(result, "utf8")) as {
    icons: Record<string, string>;
    researchTrees: { id: string; name: Record<string, string>; schematics: string[] }[];
  };
  return {
    icons: output.icons,
    researchTrees: output.researchTrees.map((tree) => ({
      id: tree.id,
      name: { en: tree.name[CULTURES.en] ?? tree.id, ...(tree.name[CULTURES.de] ? { de: tree.name[CULTURES.de] } : {}) },
      schematics: tree.schematics,
    })),
  };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
