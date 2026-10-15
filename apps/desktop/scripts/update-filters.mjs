// Downloads the ad and tracker filter lists the Browser panel ships with.
// Run by hand (`node scripts/update-filters.mjs`) and commit the result; the
// app never fetches lists itself. EasyList and EasyPrivacy are dual licensed
// under GPLv3 and CC BY-SA 3.0; Tavora uses them under CC BY-SA 3.0
// (assets/filters/NOTICE.md).
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { root } from "./targets.mjs";

const SOURCE = "https://raw.githubusercontent.com/easylist/easylist/gh-pages";
const LISTS = ["easylist.txt", "easyprivacy.txt"];

for (const name of LISTS) {
  const response = await fetch(`${SOURCE}/${name}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const text = await response.text();
  if (!text.startsWith("[Adblock Plus")) throw new Error(`${name} is not a filter list`);
  await writeFile(path.join(root, "assets/filters", `${name}.gz`), gzipSync(text, { level: 9 }));
  const version = /^! Version: (.+)$/m.exec(text)?.[1] ?? "unknown";
  console.log(`${name}: version ${version}, ${text.length} bytes`);
}
