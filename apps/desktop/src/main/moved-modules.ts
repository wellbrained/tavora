import { mkdir, readdir, readFile, rename, rmdir } from "node:fs/promises";
import path from "node:path";
import { isGameId, OFFICIAL_OWNER } from "@tavora/module-schema";
import { pathExists, writeFileAtomic } from "./fsutil";
import { modulePartition, ownPath, partitionDirName } from "./module-data";
import { GAME_OVERLAYS_FILE } from "./game-overlays";
import { HOTKEYS_FILE } from "./hotkeys";
import { defaultFilesRoot } from "./module-files";
import { OVERLAYS_FILE } from "./overlays";
import { WORKSPACE_FILE } from "./saved-data";
import { APP_DATA_DIR } from "./storage";
import { DISCORD_MODULE_ID } from "../shared/discord-voice";

export { DISCORD_MODULE_ID };

/** The AI Usage module in the catalog (Discord's id lives with its pause switch, shared/discord-voice.ts). */
export const AI_USAGE_MODULE_ID = "wellbrained.ai-usage";

/**
 * Official modules that left Tavora for the catalog (the core frame decision, 2026-10-26): each one's
 * catalog id, and the name its panels show until the user installs it.
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
 * saved goes to their catalog modules: settings, documents and files workspace by workspace (a workspace where
 * the catalog module saved something already keeps its own), browser storage, and the panels,
 * overlays, stream links and hotkeys that name them. Grants stay behind: the catalog module asks
 * for its connectors itself. A user who never installs it finds the data in Settings > Modules.
 */
export async function moveOfficialModules(userData: string, log: (line: string) => void = () => undefined, blobRoot = defaultFilesRoot(userData)): Promise<void> {
  for (const { from, to } of MOVED_MODULES) {
    // A move that fails (a file held by another program) is logged and tried again at the next start; it never stops the panels from moving.
    const attempt = async (what: string, move: () => Promise<void>) => {
      try {
        await move();
      } catch (error) {
        log(`moving ${what} of ${from} to ${to} failed, will try again at the next start: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    for (const root of [path.join(userData, "module-data"), blobRoot]) {
      // Only real folders with exactly these names (never a link, never one that matches in another case): the files root can be the user's own Pictures\Tavora.
      const source = await ownPath(root, OFFICIAL_OWNER, from);
      if (!source) continue;
      for (const game of await readdir(source).catch(() => [] as string[])) {
        if (!isGameId(game) && game !== APP_DATA_DIR) continue;
        const folder = await ownPath(source, game);
        if (!folder) continue;
        const target = path.join(root, MOVED_MODULES_OWNER, to, game);
        if (await pathExists(target)) {
          log(`${to} already has data in ${game}; what ${from} saved there stays`);
          continue;
        }
        await attempt(`the data in ${game}`, async () => {
          await mkdir(path.dirname(target), { recursive: true });
          await rename(folder, target);
        });
      }
      await rmdir(source).catch(() => undefined);
    }
    const partitions = path.join(userData, "Partitions");
    for (const name of await readdir(partitions).catch(() => [] as string[])) {
      const game = name.slice(name.lastIndexOf("@") + 1).toLowerCase();
      if (!isGameId(game) || name.toLowerCase() !== partitionDirName(modulePartition(OFFICIAL_OWNER, from, game)).toLowerCase()) continue;
      const folder = await ownPath(partitions, name);
      if (!folder) continue;
      const target = path.join(partitions, partitionDirName(modulePartition(MOVED_MODULES_OWNER, to, game)));
      if (!(await pathExists(target))) await attempt(`the browser storage in ${game}`, () => rename(folder, target));
    }
  }
  await renameIn(path.join(userData, WORKSPACE_FILE), true);
  for (const file of [GAME_OVERLAYS_FILE, OVERLAYS_FILE, HOTKEYS_FILE]) await renameIn(path.join(userData, file), false);
}

/**
 * Points every record of a moved module in one saved file at its catalog module. In the overlays, stream links and
 * hotkeys, a record's owner names the copy it is for: only the official copy's move. A panel's owner in the workspace
 * (`panels`) names whose page ran in it last (host.ts settleOwner): every panel moves, and one the official copy ran in
 * goes on as the catalog module's, as its data does; another owner's stays noted, so the catalog module starts it
 * without what that owner left.
 */
async function renameIn(file: string, panels: boolean): Promise<void> {
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
    if (moved && (panels || !("owner" in record) || record.owner === OFFICIAL_OWNER)) {
      record.moduleId = moved.to;
      if ("owner" in record && record.owner === OFFICIAL_OWNER) record.owner = MOVED_MODULES_OWNER;
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

