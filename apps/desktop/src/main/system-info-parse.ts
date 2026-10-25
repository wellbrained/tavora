/**
 * The pure parts of the system-info connector (system-info.ts): checking what a panel asks to watch, and turning
 * Windows' counter names into numbers per graphics card. Nothing here touches the PC.
 */
import { SYSTEM_INTERVALS_MS, SYSTEM_MAX_DRIVES, type SystemInterval } from "@tavora/sdk/protocol";
import { HostError } from "./errors";

/** What one panel watches, checked: every part spelled out, drive letters without repeats. */
export interface WatchBlocks {
  cpu: boolean;
  gpu: boolean;
  ram: boolean;
  drives: string[];
  tavora: boolean;
}

export interface WatchRequest {
  blocks: WatchBlocks;
  intervalMs: SystemInterval;
}

const BLOCK_KEYS = new Set(["cpu", "gpu", "ram", "drives", "tavora"]);
const DRIVE_ID = /^[A-Z]:$/;

/** Whether the watch asks for nothing, which stops it. */
export function isEmptyWatch(blocks: WatchBlocks): boolean {
  return !blocks.cpu && !blocks.gpu && !blocks.ram && !blocks.tavora && blocks.drives.length === 0;
}

/** Checks the params of systemInfo.watch strictly: unknown keys, wrong types and intervals Tavora doesn't offer are refused. */
export function parseWatch(params: unknown): WatchRequest {
  if (typeof params !== "object" || params === null || Array.isArray(params)) throw new HostError("INVALID_PARAMS", "params must be an object");
  const record = params as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "blocks" && key !== "intervalMs") throw new HostError("INVALID_PARAMS", `params.${key} is not known`);
  }
  const intervalMs = record.intervalMs;
  if (!SYSTEM_INTERVALS_MS.includes(intervalMs as SystemInterval)) {
    throw new HostError("INVALID_PARAMS", `params.intervalMs must be one of ${SYSTEM_INTERVALS_MS.join(", ")}`);
  }
  const given = record.blocks;
  if (typeof given !== "object" || given === null || Array.isArray(given)) throw new HostError("INVALID_PARAMS", "params.blocks must be an object");
  const blocks: WatchBlocks = { cpu: false, gpu: false, ram: false, drives: [], tavora: false };
  for (const [key, value] of Object.entries(given as Record<string, unknown>)) {
    if (!BLOCK_KEYS.has(key)) throw new HostError("INVALID_PARAMS", `params.blocks.${key} is not known`);
    if (key === "drives") {
      if (!Array.isArray(value) || value.length > SYSTEM_MAX_DRIVES || !value.every((id) => typeof id === "string" && DRIVE_ID.test(id))) {
        throw new HostError("INVALID_PARAMS", `params.blocks.drives must be at most ${SYSTEM_MAX_DRIVES} drive letters such as "C:"`);
      }
      blocks.drives = [...new Set(value as string[])];
    } else {
      if (typeof value !== "boolean") throw new HostError("INVALID_PARAMS", `params.blocks.${key} must be true or false`);
      blocks[key as "cpu" | "gpu" | "ram" | "tavora"] = value;
    }
  }
  return { blocks, intervalMs: intervalMs as SystemInterval };
}

/** A percentage kept between 0 and 100 with one decimal; anything that isn't a number is 0. */
export function percent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

const LUID = /luid_0x([0-9a-f]{8})_0x([0-9a-f]{8})/i;

/** The id of a graphics card from a Windows counter name such as `pid_12_luid_0x00000000_0x0001DEFC_phys_0_eng_0_engtype_3D`, or null. */
export function luidOf(instance: string): string | null {
  const match = LUID.exec(instance);
  return match ? `0x${match[1]!.toLowerCase()}_0x${match[2]!.toLowerCase()}` : null;
}

/** The id for an adapter's LUID as DXGI gives it. */
export function luidId(high: number, low: number): string {
  return `0x${(high >>> 0).toString(16).padStart(8, "0")}_0x${(low >>> 0).toString(16).padStart(8, "0")}`;
}

const ENGINE_TYPE = /_engtype_(.+)$/;

/**
 * How busy each graphics card is from the `GPU Engine` counters, the way Task Manager counts: the instances of one
 * kind of engine (3D, Copy, VideoDecode ...) are added up, and the card is as busy as its busiest kind. 0 to 100.
 */
export function gpuUsageByAdapter(engines: Iterable<{ name: string; value: number }>): Map<string, number> {
  const sums = new Map<string, Map<string, number>>();
  for (const { name, value } of engines) {
    const id = luidOf(name);
    if (!id || !Number.isFinite(value)) continue;
    const kind = ENGINE_TYPE.exec(name)?.[1] ?? "";
    const kinds = sums.get(id) ?? new Map<string, number>();
    kinds.set(kind, (kinds.get(kind) ?? 0) + Math.max(0, value));
    sums.set(id, kinds);
  }
  const result = new Map<string, number>();
  for (const [id, kinds] of sums) result.set(id, Math.min(100, Math.max(0, ...kinds.values())));
  return result;
}

/** Video memory in use per graphics card from the `GPU Adapter Memory` counters (instances look like `luid_0x..._0x..._phys_0`). */
export function gpuMemoryByAdapter(items: Iterable<{ name: string; value: number }>): Map<string, number> {
  const result = new Map<string, number>();
  for (const { name, value } of items) {
    const id = luidOf(name);
    if (id && Number.isFinite(value)) result.set(id, (result.get(id) ?? 0) + Math.max(0, Math.round(value)));
  }
  return result;
}

/**
 * The logical processors from the `Processor Information` counters, in order. Instances are named `group,number`
 * (`0,3`); the totals (`_Total`, `0,_Total`) are left out.
 */
export function coresInOrder(items: Iterable<{ name: string; value: number }>): number[] {
  const cores: { group: number; index: number; value: number }[] = [];
  for (const { name, value } of items) {
    const match = /^(\d+),(\d+)$/.exec(name);
    if (match) cores.push({ group: Number(match[1]), index: Number(match[2]), value });
  }
  cores.sort((a, b) => a.group - b.group || a.index - b.index);
  return cores.map((core) => core.value);
}
