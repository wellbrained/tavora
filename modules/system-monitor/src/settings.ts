// What the user chose, and what that asks Tavora to watch. Pure, so it is tested on its own.
//  - Module-wide (`storage.app`): how often it updates, and which drives to watch (null until the user has chosen).
//  - Per panel (`panel.setState`): which sections (System, Connection) and blocks show, which graphics card, and
//    whether the traffic shows (off until the user turns it on; while off, Tavora reads none).
//  - The connection watcher's own choices (on or off, the address pinged) are Tavora's, not kept here.
import { SYSTEM_INTERVALS_MS, SYSTEM_MAX_DRIVES, type SystemInfo, type SystemInterval, type SystemWatchBlocks } from "@tavora/sdk";

export const BLOCKS = ["cpu", "gpu", "ram", "drives"] as const;
export type BlockId = (typeof BLOCKS)[number];

/** The two sections of the panel; either can be hidden, but not both. */
export const SECTIONS = ["system", "connection"] as const;
export type SectionId = (typeof SECTIONS)[number];

export const INTERVALS = SYSTEM_INTERVALS_MS;
export const DEFAULT_INTERVAL: SystemInterval = 1000;

/** The peak next to CPU and GPU shows from this interval on; below it the peak is the same as the usage. */
export const PEAK_FROM_MS = 5000;

/** Graph history kept in memory, never saved. */
export const HISTORY_MS = 5 * 60 * 1000;

export interface AppSettings {
  intervalMs: SystemInterval;
  /** The drives to watch, as the user ticked them; null until they have chosen, so the internal ones show. */
  drives: string[] | null;
}

export interface PanelSettings {
  sections: Record<SectionId, boolean>;
  blocks: Record<BlockId, boolean>;
  /** The graphics card to show when there are several; null for the dedicated one. */
  gpu: string | null;
  /** Whether the Connection section shows the traffic of this week and the last months. */
  traffic: boolean;
}

export const APP_KEY = "settings";

export const defaultApp = (): AppSettings => ({ intervalMs: DEFAULT_INTERVAL, drives: null });
export const defaultPanel = (): PanelSettings => ({ sections: { system: true, connection: true }, blocks: { cpu: true, gpu: true, ram: true, drives: true }, gpu: null, traffic: false });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function parseApp(raw: unknown): AppSettings {
  const result = defaultApp();
  if (!isRecord(raw)) return result;
  const interval = INTERVALS.find((ms) => ms === raw.intervalMs);
  if (interval) result.intervalMs = interval;
  if (Array.isArray(raw.drives)) {
    const ids = raw.drives.filter((id): id is string => typeof id === "string" && /^[A-Za-z]:$/.test(id)).map((id) => id.toUpperCase());
    result.drives = [...new Set(ids)].slice(0, SYSTEM_MAX_DRIVES);
  }
  return result;
}

export function parsePanel(raw: unknown): PanelSettings {
  const result = defaultPanel();
  if (!isRecord(raw)) return result;
  if (isRecord(raw.sections)) {
    for (const id of SECTIONS) {
      const value = raw.sections[id];
      if (typeof value === "boolean") result.sections[id] = value;
    }
  }
  // At least one section always shows.
  if (!SECTIONS.some((id) => result.sections[id])) result.sections = defaultPanel().sections;
  if (isRecord(raw.blocks)) {
    const blocks = raw.blocks;
    for (const id of BLOCKS) {
      const value = blocks[id];
      if (typeof value === "boolean") result.blocks[id] = value;
    }
  }
  // At least one block always shows.
  if (!BLOCKS.some((id) => result.blocks[id])) result.blocks = defaultPanel().blocks;
  if (typeof raw.gpu === "string") result.gpu = raw.gpu;
  if (typeof raw.traffic === "boolean") result.traffic = raw.traffic;
  return result;
}

/** Turns a block on or off; the last one shown can't be turned off. */
export function toggleBlock(panel: PanelSettings, id: BlockId): PanelSettings {
  const blocks = { ...panel.blocks, [id]: !panel.blocks[id] };
  return BLOCKS.some((block) => blocks[block]) ? { ...panel, blocks } : panel;
}

/** Turns a section on or off; the last one shown can't be turned off. */
export function toggleSection(panel: PanelSettings, id: SectionId): PanelSettings {
  const sections = { ...panel.sections, [id]: !panel.sections[id] };
  return SECTIONS.some((section) => sections[section]) ? { ...panel, sections } : panel;
}

/** The internal drives, which are watched until the user chooses. */
export function defaultDrives(info: SystemInfo): string[] {
  return info.drives.filter((drive) => drive.kind === "internal").map((drive) => drive.id);
}

/** The drives to watch: the user's choice, which may name a drive that is unplugged now, or the internal ones. */
export function watchedDrives(info: SystemInfo, settings: AppSettings): string[] {
  return (settings.drives ?? defaultDrives(info)).slice(0, SYSTEM_MAX_DRIVES);
}

/** Which graphics card to show: the chosen one if it is still there, else the dedicated one, else the first. */
export function pickGpu(info: SystemInfo, chosen: string | null): string | null {
  const gpus = info.gpus;
  return (gpus.find((gpu) => gpu.id === chosen) ?? gpus.find((gpu) => gpu.dedicated) ?? gpus[0])?.id ?? null;
}

export interface WatchRequest {
  blocks: SystemWatchBlocks;
  intervalMs: SystemInterval;
}

/** What to ask Tavora to watch: only what this panel shows. Tavora's own use is always there for the bottom line. */
export function watchRequest(info: SystemInfo, app: AppSettings, panel: PanelSettings): WatchRequest {
  const blocks: SystemWatchBlocks = { tavora: true };
  if (panel.sections.connection) blocks.connection = true;
  if (panel.sections.system) {
    if (panel.blocks.cpu) blocks.cpu = true;
    if (panel.blocks.gpu && info.gpus.length > 0) blocks.gpu = true;
    if (panel.blocks.ram) blocks.ram = true;
    const drives = watchedDrives(info, app);
    if (panel.blocks.drives && drives.length > 0) blocks.drives = drives;
  }
  return { blocks, intervalMs: app.intervalMs };
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** The address to ping as Tavora takes it (an IPv4 address or a name, in lower case), or null when it is neither. Tavora checks it again. */
export function cleanTarget(text: string): string | null {
  const target = text.trim().toLowerCase().replace(/\.$/, "");
  const ip = IPV4.exec(target);
  if (ip) {
    const parts = ip.slice(1).map(Number);
    return parts.every((part) => part <= 255) && parts[0]! > 0 && parts[0]! < 224 ? target : null;
  }
  // A name needs a dot: one without is on the local network. Tavora refuses private and local ones too.
  if (target.length === 0 || target.length > 253 || !target.includes(".") || /^[\d.]+$/.test(target)) return null;
  return target.split(".").every((label) => LABEL.test(label)) ? target : null;
}

/** The same request as text, to tell whether anything changed. */
export const requestKey = (request: WatchRequest): string => JSON.stringify(request);
