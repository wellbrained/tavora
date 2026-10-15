import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isIconId } from "./icons.ts";
import { icoToPng, inspectPng } from "./png.ts";

/**
 * Changes to the hosted icon folder: adding an icon (a PNG, or an .ico whose
 * biggest frame is turned into one without changing a pixel) and removing one.
 * A removal is how a publisher's request is met. The folder holds `<id>.png`
 * files and an `index.json` that `loadIconStore` checks on every start.
 */

export class IconFileError extends Error {}

interface IconRecord {
  id: string;
  names: string[];
  sha256: string;
  /** Where the icon came from, for the people who run the service. Never served. */
  source: string;
  addedAt: string;
}

function readIndex(dir: string): IconRecord[] {
  const file = path.join(dir, "index.json");
  if (!existsSync(file)) return [];
  const icons = (JSON.parse(readFileSync(file, "utf8")) as { icons?: unknown }).icons;
  return Array.isArray(icons) ? (icons as IconRecord[]) : [];
}

function writeIndex(dir: string, icons: IconRecord[]): void {
  const sorted = [...icons].sort((a, b) => a.id.localeCompare(b.id));
  const file = path.join(dir, "index.json");
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ icons: sorted }, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

export interface AddIconInput {
  id: string;
  names: string[];
  /** A PNG or an .ico file. */
  bytes: Uint8Array;
  source: string;
  now?: Date;
}

/** Adds or replaces an icon and records it. Returns what was recorded. */
export function addIcon(dir: string, input: AddIconInput): { id: string; sha256: string; size: number } {
  if (!isIconId(input.id)) throw new IconFileError("The id must be lower-case letters, digits and dashes.");
  const names = input.names.map((name) => name.trim()).filter(Boolean);
  if (names.length === 0 || names.length > 8 || names.some((name) => name.length > 120)) {
    throw new IconFileError("Give one to eight names, each up to 120 characters.");
  }
  if (!input.source.trim()) throw new IconFileError("Say where the icon came from.");
  const png = inspectPng(input.bytes) ? input.bytes : icoToPng(input.bytes);
  if (!png || !inspectPng(png)) throw new IconFileError("That is not a PNG or an .ico with a readable frame of at most 256 px.");

  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${input.id}.png`);
  writeFileSync(`${target}.tmp`, png);
  renameSync(`${target}.tmp`, target);
  const sha256 = createHash("sha256").update(png).digest("hex");
  const record: IconRecord = { id: input.id, names, sha256, source: input.source.trim(), addedAt: (input.now ?? new Date()).toISOString() };
  writeIndex(dir, [...readIndex(dir).filter((icon) => icon.id !== input.id), record]);
  return { id: input.id, sha256, size: png.byteLength };
}

/** Removes an icon and its file. Returns whether there was one. */
export function removeIcon(dir: string, id: string): boolean {
  if (!isIconId(id)) throw new IconFileError("That is not a valid icon id.");
  const icons = readIndex(dir);
  const had = icons.some((icon) => icon.id === id) || existsSync(path.join(dir, `${id}.png`));
  rmSync(path.join(dir, `${id}.png`), { force: true });
  if (existsSync(path.join(dir, "index.json"))) writeIndex(dir, icons.filter((icon) => icon.id !== id));
  return had;
}
