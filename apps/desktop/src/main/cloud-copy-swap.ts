// Where putting a cloud copy in place stands: one value, kept in its own file, written before any step that depends on
// it. Older Tavoras don't know the file, so it can't mislead them. Transitions are the pure stepSwap below.
import { rm } from "node:fs/promises";
import path from "node:path";
import { DamagedFile, lookJson, type Looked } from "./file-look";
import { writeFileAtomic } from "./fsutil";

export const COPY_STATUS_FILE = "cloud-copy-status.json";

/** What a swap needs to go on from any point, or to be taken back. */
export interface SwapPlan {
  /** The backup folder for what was here. */
  keepIn: string;
  /** The module files folder when it began: the library that names it may be the part that is moved away. */
  moduleFiles: string;
  /** This PC's own settings from before the swap (PC_SETTINGS). */
  own: Record<string, unknown> | null;
  /** Places the copy fills that held nothing before it: taking the swap back empties them again. */
  empty: string[];
}

/**
 * - `idle`: nothing is going on (no file).
 * - `chosen`: the user chose the staged copy; it goes in at the next start, and nothing goes up until it has.
 * - `swapping`: files are moving, or stopped halfway. The next start finishes.
 * - `undoing`: the user went back to this PC's data, or turned the copy off. The next start takes the swap back.
 * - `asking`: the user has to choose a side: data was `lost` here, or they `went-back` from a copy.
 * - `held`: in memory only. This start couldn't read or settle what is there, so it does nothing until the next. `open`
 *   when a swap may be half done or the user has to answer, which the dialog then asks; otherwise it is only a problem note.
 */
export type SwapStatus =
  | { phase: "idle" }
  | { phase: "chosen" }
  | { phase: "swapping"; plan: SwapPlan }
  | { phase: "undoing"; plan: SwapPlan }
  | { phase: "asking"; why: "lost" | "went-back"; files: string[] }
  | { phase: "held"; open: boolean };

export type SwapEvent =
  /** The user chose the staged copy. */
  | { type: "chosen" }
  /** The first file is about to move. */
  | { type: "begin"; plan: SwapPlan }
  /** The state says the copy is in. */
  | { type: "finished" }
  /** The user chose this PC's data during a swap. */
  | { type: "go-back" }
  /** The user chose the copy during a swap: it stays as it is. A swap being taken back finishes that first, then asks. */
  | { type: "try-again" }
  /** The swap was taken back. With the copy on, the question stands until it is answered. */
  | { type: "went-back"; copyOn: boolean }
  /** Data files are lost here. */
  | { type: "lost"; files: string[] }
  /** The chosen copy can't be used any more: the user chooses again. */
  | { type: "copy-gone" }
  /** The user answered the question. */
  | { type: "answered" }
  /** The copy is being forgotten on this PC. */
  | { type: "forgotten" };

export const SWAP_IDLE: SwapStatus = { phase: "idle" };

/** The next status; an event that doesn't apply leaves it as it is. */
export function stepSwap(status: SwapStatus, event: SwapEvent): SwapStatus {
  switch (event.type) {
    case "chosen":
      return status.phase === "idle" || status.phase === "asking" || status.phase === "chosen" ? { phase: "chosen" } : status;
    case "begin":
      return status.phase === "idle" || status.phase === "chosen" ? { phase: "swapping", plan: event.plan } : status;
    case "finished":
      return status.phase === "swapping" ? SWAP_IDLE : status;
    case "go-back":
      return status.phase === "swapping" || status.phase === "undoing" ? { phase: "undoing", plan: status.plan } : status;
    case "try-again":
      return status;
    case "went-back":
      if (status.phase !== "undoing") return status;
      return event.copyOn ? { phase: "asking", why: "went-back", files: [] } : SWAP_IDLE;
    case "lost":
      if (status.phase === "idle") return { phase: "asking", why: "lost", files: event.files };
      return status.phase === "asking" ? { phase: "asking", why: "lost", files: [...new Set([...status.files, ...event.files])] } : status;
    case "copy-gone":
      return status.phase === "chosen" ? { phase: "asking", why: "went-back", files: [] } : status;
    case "answered":
      return status.phase === "chosen" || status.phase === "asking" ? SWAP_IDLE : status;
    case "forgotten":
      if (status.phase === "swapping" || status.phase === "undoing") return { phase: "undoing", plan: status.plan };
      return status.phase === "held" ? status : SWAP_IDLE;
  }
}

function parsePlan(value: unknown, backups: string): SwapPlan | null {
  if (typeof value !== "object" || value === null) return null;
  const { keepIn, moduleFiles, own, empty } = value as Record<string, unknown>;
  if (typeof keepIn !== "string" || path.dirname(keepIn) !== backups || typeof moduleFiles !== "string" || !path.isAbsolute(moduleFiles)) return null;
  if (!Array.isArray(empty) || !empty.every((place) => typeof place === "string")) return null;
  return { keepIn, moduleFiles, own: typeof own === "object" && own !== null && !Array.isArray(own) ? (own as Record<string, unknown>) : null, empty: empty as string[] };
}

function parseStatus(saved: Record<string, unknown>, backups: string): SwapStatus | null {
  if (saved.v !== 1) return null;
  switch (saved.phase) {
    case "chosen":
      return { phase: "chosen" };
    case "swapping":
    case "undoing": {
      const plan = parsePlan(saved.plan, backups);
      return plan && { phase: saved.phase, plan };
    }
    case "asking":
      if ((saved.why !== "lost" && saved.why !== "went-back") || !Array.isArray(saved.files) || !saved.files.every((name) => typeof name === "string")) return null;
      return { phase: "asking", why: saved.why, files: saved.files as string[] };
    default:
      return null;
  }
}

/** The plan kept next to the staged copy: it says a swap began, also when the status can't be read. */
export async function lookSwapPlan(file: string, backups: string): Promise<Looked<SwapPlan>> {
  const looked = await lookJson(file);
  if (looked.status !== "present") return looked;
  const plan = parsePlan(looked.value, backups);
  return plan ? { status: "present", value: plan } : { status: "held", error: new DamagedFile(`${file} is damaged`) };
}

/** The status on disk: no file is `idle`, and one that is busy or damaged is held. `backups` is the folder a plan's backup must be in. */
export async function lookSwapStatus(file: string, backups: string): Promise<Looked<SwapStatus>> {
  const looked = await lookJson(file);
  if (looked.status === "missing") return { status: "present", value: SWAP_IDLE };
  if (looked.status === "held") return looked;
  const status = parseStatus(looked.value, backups);
  return status ? { status: "present", value: status } : { status: "held", error: new DamagedFile(`${file} is damaged`) };
}

/** Writes the status before anything goes on; `idle` removes the file. */
export async function writeSwapStatus(file: string, status: SwapStatus): Promise<void> {
  if (status.phase === "held") throw new Error("a held status is never written");
  if (status.phase === "idle") return rm(file, { force: true });
  return writeFlushed(file, { v: 1, ...status });
}

/** Writes JSON whole and on the disk (writeFileAtomic flushes it before the rename). */
export function writeFlushed(file: string, value: unknown): Promise<void> {
  return writeFileAtomic(file, JSON.stringify(value));
}
