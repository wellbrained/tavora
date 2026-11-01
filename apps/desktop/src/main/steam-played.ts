import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * When the user last played each Steam game, from the `LastPlayed` Steam keeps for every account on this PC in
 * `userdata/<id>/config/localconfig.vdf`. The files are only read, never changed, and what they say stays on this PC.
 */

type Vdf = { [key: string]: string | Vdf };

/** A file bigger than this is not a localconfig.vdf worth reading. */
const MAX_BYTES = 16 * 1024 * 1024;
/** Deeper than Steam ever writes; stops a hostile file from nesting without end. */
const MAX_DEPTH = 24;

/** Valve's text format as nested objects. Reads what it can; a broken or cut-off file gives what came before the break. */
export function parseVdf(text: string): Vdf {
  const root: Vdf = {};
  const stack: Vdf[] = [root];
  let pendingKey: string | null = null;
  const length = text.length;
  let i = 0;
  while (i < length) {
    const char = text[i]!;
    if (char === '"') {
      let value = "";
      i += 1;
      while (i < length && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < length) {
          i += 1;
          const next = text[i]!;
          value += next === "n" ? "\n" : next === "t" ? "\t" : next;
        } else {
          value += text[i];
        }
        i += 1;
      }
      i += 1;
      const current = stack[stack.length - 1]!;
      if (pendingKey === null) {
        pendingKey = value;
      } else {
        current[pendingKey] = value;
        pendingKey = null;
      }
    } else if (char === "{") {
      if (pendingKey !== null && stack.length < MAX_DEPTH) {
        const child: Vdf = {};
        stack[stack.length - 1]![pendingKey] = child;
        stack.push(child);
      } else {
        // A block with no name, or too deep: skip it by counting braces.
        let depth = 1;
        i += 1;
        while (i < length && depth > 0) {
          if (text[i] === "{") depth += 1;
          else if (text[i] === "}") depth -= 1;
          i += 1;
        }
        pendingKey = null;
        continue;
      }
      pendingKey = null;
      i += 1;
    } else if (char === "}") {
      if (stack.length > 1) stack.pop();
      pendingKey = null;
      i += 1;
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < length && text[i] !== "\n") i += 1;
    } else {
      i += 1;
    }
  }
  return root;
}

function child(node: Vdf | string | undefined, name: string): Vdf | undefined {
  if (!node || typeof node === "string") return undefined;
  const key = Object.keys(node).find((candidate) => candidate.toLowerCase() === name);
  const found = key === undefined ? undefined : node[key];
  return typeof found === "object" ? found : undefined;
}

/**
 * The last time each game was played, by Steam application id, in seconds since 1970, from the text of one
 * localconfig.vdf. A game never played (LastPlayed 0 or missing) is left out.
 */
export function parseLastPlayed(text: string): Map<number, number> {
  const played = new Map<number, number>();
  const root = parseVdf(text);
  const store = child(root, "userlocalconfigstore") ?? root;
  const apps = child(child(child(child(store, "software"), "valve"), "steam"), "apps");
  if (!apps) return played;
  for (const [id, entry] of Object.entries(apps)) {
    if (!/^\d{1,10}$/.test(id) || typeof entry === "string") continue;
    const key = Object.keys(entry).find((candidate) => candidate.toLowerCase() === "lastplayed");
    const seconds = key === undefined ? NaN : Number(entry[key]);
    // Between 2003 and 2100 is a date Steam could have written.
    if (Number.isInteger(seconds) && seconds > 1_050_000_000 && seconds < 4_102_444_800) played.set(Number(id), seconds);
  }
  return played;
}

/** Of several accounts on one PC, the latest play of each game. */
export function mergeLastPlayed(maps: readonly Map<number, number>[]): Map<number, number> {
  const merged = new Map<number, number>();
  for (const map of maps) for (const [id, seconds] of map) if (seconds > (merged.get(id) ?? 0)) merged.set(id, seconds);
  return merged;
}

/** The last play of every Steam game on this PC, over all accounts that signed in here. Empty when Steam has nothing to read. */
export async function readSteamLastPlayed(steamDir: string): Promise<Map<number, number>> {
  const users = path.join(steamDir, "userdata");
  let ids: string[];
  try {
    ids = (await readdir(users)).filter((name) => /^\d+$/.test(name)).slice(0, 50);
  } catch {
    return new Map();
  }
  const maps = await Promise.all(
    ids.map(async (id) => {
      try {
        const file = path.join(users, id, "config", "localconfig.vdf");
        if ((await stat(file)).size > MAX_BYTES) return new Map<number, number>();
        return parseLastPlayed(await readFile(file, "utf8"));
      } catch {
        return new Map<number, number>();
      }
    }),
  );
  return mergeLastPlayed(maps);
}
