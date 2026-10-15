// Compiles the bundled filter lists (assets/filters) into the engine the
// Browser panel loads at start (out/filters/engine.bin), so the app never
// parses lists at run time. The engine format belongs to the adblocker
// version it was built with, which is the one bundled into main.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { FiltersEngine } from "@ghostery/adblocker";
import { root } from "./targets.mjs";

const LISTS = ["easylist.txt.gz", "easyprivacy.txt.gz"];

export async function buildFilterEngine() {
  const lists = await Promise.all(LISTS.map(async (name) => gunzipSync(await readFile(path.join(root, "assets/filters", name))).toString("utf8")));
  // Network rules only: cosmetic filtering needs a script in every page (docs/browser-security.md).
  const engine = FiltersEngine.parse(lists.join("\n"), { loadCosmeticFilters: false, loadNetworkFilters: true, enableHtmlFiltering: false });
  const out = path.join(root, "out/filters/engine.bin");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, engine.serialize());
}
