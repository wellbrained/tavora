import { mkdir, readdir, readFile, rename, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { isGameId, OFFICIAL_OWNER } from "@tavora/module-schema";
import { writeFileAtomic } from "./fsutil";
import { modulePartition, partitionDirName } from "./gamedata";
import { GAME_OVERLAYS_FILE } from "./game-overlays";
import { HOTKEYS_FILE } from "./hotkeys";
import { defaultFilesRoot } from "./module-files";
import { OVERLAYS_FILE } from "./overlays";
import { WORKSPACE_FILE } from "./saved-data";
import { APP_DATA_DIR } from "./storage";

/** The Discord and AI Usage modules in the catalog. */
export const DISCORD_MODULE_ID = "wellbrained.discord";
export const AI_USAGE_MODULE_ID = "wellbrained.ai-usage";

/**
 * Official modules that left Tavora for the catalog (the core frame decision, 2026-10-26): each one's
 * catalog id, and the name its panels show until the player installs it.
 */
export const MOVED_MODULES: readonly { from: string; to: string; name: string }[] = [
  { from: "tavora.discord", to: DISCORD_MODULE_ID, name: "Discord" },
  { from: "tavora.ai-usage", to: AI_USAGE_MODULE_ID, name: "AI Usage" },
];

/** Who publishes them in the catalog: the WellBrained publisher key, Tavora's own. Their data moves to this owner. */
export const MOVED_MODULES_OWNER = "2b85409d347617c9b8fe014fae1d90ec";

/** The moved module a catalog id stands for, if it is one. */
export function movedModule(moduleId: string): (typeof MOVED_MODULES)[number] | undefined {
  return MOVED_MODULES.find((moved) => moved.to === moduleId);
}

/**
 * Runs at every start, before any module session or store is opened. What the official copies
 * saved goes to their catalog modules: settings, documents and files game by game (a game where
 * the catalog module saved something already keeps its own), browser storage, and the panels,
 * overlays, stream links and hotkeys that name them. Grants stay behind: the catalog module asks
 * for its connectors itself. A player who never installs it finds the data in Settings > Modules.
 */
export async function moveOfficialModules(userData: string, log: (line: string) => void = () => undefined, blobRoot = defaultFilesRoot(userData)): Promise<void> {
  for (const { from, to } of MOVED_MODULES) {
    for (const root of [path.join(userData, "module-data"), blobRoot]) {
      const source = path.join(root, OFFICIAL_OWNER, from);
      for (const game of await readdir(source).catch(() => [] as string[])) {
        if (!isGameId(game) && game !== APP_DATA_DIR) continue;
        const target = path.join(root, MOVED_MODULES_OWNER, to, game);
        if (await exists(target)) {
          log(`${to} already has data in ${game}; what ${from} saved there stays`);
          continue;
        }
        await mkdir(path.dirname(target), { recursive: true });
        await rename(path.join(source, game), target);
      }
      await rmdir(source).catch(() => undefined);
    }
    const partitions = path.join(userData, "Partitions");
    for (const name of await readdir(partitions).catch(() => [] as string[])) {
      const game = name.slice(name.lastIndexOf("@") + 1).toLowerCase();
      if (!isGameId(game) || name.toLowerCase() !== partitionDirName(modulePartition(OFFICIAL_OWNER, from, game)).toLowerCase()) continue;
      const target = path.join(partitions, partitionDirName(modulePartition(MOVED_MODULES_OWNER, to, game)));
      if (!(await exists(target))) await rename(path.join(partitions, name), target);
    }
  }
  for (const file of [WORKSPACE_FILE, GAME_OVERLAYS_FILE, OVERLAYS_FILE, HOTKEYS_FILE]) await renameIn(path.join(userData, file));
}

/** Points every record of a moved module in one saved file at its catalog module. */
async function renameIn(file: string): Promise<void> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return;
  }
  if (!MOVED_MODULES.some(({ from }) => text.includes(`"${from}"`))) return;
  let changed = false;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    const moved = MOVED_MODULES.find(({ from }) => record.moduleId === from);
    // Records with an owner name one (the official copy); the workspace's name the module alone.
    if (moved && (!("owner" in record) || record.owner === OFFICIAL_OWNER)) {
      record.moduleId = moved.to;
      if ("owner" in record) record.owner = MOVED_MODULES_OWNER;
      changed = true;
    }
    // A saved layout names the module of each slot: `modules: { slot: moduleId }`.
    if (typeof record.modules === "object" && record.modules !== null && !Array.isArray(record.modules)) {
      const slots = record.modules as Record<string, unknown>;
      for (const [slot, moduleId] of Object.entries(slots)) {
        const target = MOVED_MODULES.find(({ from }) => moduleId === from)?.to;
        if (target) {
          slots[slot] = target;
          changed = true;
        }
      }
    }
    Object.values(record).forEach(visit);
  };
  try {
    const parsed: unknown = JSON.parse(text);
    visit(parsed);
    if (changed) await writeFileAtomic(file, `${JSON.stringify(parsed, null, 2)}\n`);
  } catch {
    // A damaged file is left to the code that reads it.
  }
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}
