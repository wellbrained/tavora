// The data side of the Whiteboard: what a stored board looks like and the pure rules for ids, names and size.
// Kept free of React and Excalidraw so it can be unit tested.

import type { JsonValue } from "@tavora/sdk";

/** What the Whiteboard stores in each document. */
export interface BoardData {
  [key: string]: JsonValue;
  version: 1;
  /** Excalidraw's elements, without the ones that were deleted. */
  elements: JsonValue[];
  /** The colour of the board's background. */
  background: string;
  createdAt: string;
}

/** A board as the dropdown lists it. */
export interface BoardSummary {
  id: string;
  name: string;
  revision: number;
}

/** A document holds 4 MB at most; the board warns well before. */
export const MAX_BOARD_BYTES = 4 * 1024 * 1024;
export const WARN_BOARD_BYTES = 3 * 1024 * 1024;
export const MAX_NAME = 60;

export const DEFAULT_BACKGROUND = "#ffffff";

export function emptyBoard(now = new Date().toISOString()): BoardData {
  return { version: 1, elements: [], background: DEFAULT_BACKGROUND, createdAt: now };
}

/** Turns stored data into a valid board, whatever an older version or a bad write left there. */
export function parseBoard(raw: JsonValue | null, now = new Date().toISOString()): BoardData {
  const value = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    version: 1,
    elements: Array.isArray(value.elements) ? value.elements.filter((element) => element !== null && typeof element === "object" && !Array.isArray(element)) : [],
    background: typeof value.background === "string" && /^#[0-9a-fA-F]{3,8}$|^transparent$/.test(value.background) ? value.background : DEFAULT_BACKGROUND,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
  };
}

/** A board's name: one line, trimmed, kept to a sensible length. */
export function cleanName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME).trimEnd();
}

/**
 * An id that sorts in the order boards were made (the time first), so the list keeps its order without storing one.
 * Letters and digits only, within what the host allows for a document id.
 */
export function newBoardId(now = Date.now(), random = Math.random()): string {
  return `board-${now.toString(36).padStart(9, "0")}-${Math.floor(random * 36 ** 4).toString(36).padStart(4, "0")}`;
}

export function isBoardId(id: string): boolean {
  return /^board-[a-z0-9]{9}-[a-z0-9]{4}$/.test(id);
}

/** The first "Board 1", "Board 2" … that no board in the list has. */
export function nextBoardName(names: readonly string[], word: string): string {
  const taken = new Set(names.map((name) => name.toLocaleLowerCase()));
  for (let n = names.length + 1; ; n++) {
    if (!taken.has(`${word} ${n}`.toLocaleLowerCase())) return `${word} ${n}`;
  }
}

/** The boards in the order they were made. */
export function sortBoards<T extends { id: string }>(boards: readonly T[]): T[] {
  return [...boards].sort((a, b) => a.id.localeCompare(b.id));
}

export type SizeLevel = "ok" | "warn" | "full";

/** How full a board is: fine, getting close to the 4 MB a document holds, or too big to save. */
export function sizeLevel(bytes: number): SizeLevel {
  return bytes > MAX_BOARD_BYTES ? "full" : bytes > WARN_BOARD_BYTES ? "warn" : "ok";
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A cheap fingerprint of a scene, to tell whether it changed: one number per element that changes with every edit. */
export function sceneSignature(elements: readonly { versionNonce: number; isDeleted?: boolean }[], background: string): string {
  let hash = elements.length;
  for (const element of elements) hash = (Math.imul(hash, 31) + element.versionNonce + (element.isDeleted ? 1 : 0)) | 0;
  return `${hash}:${background}`;
}
