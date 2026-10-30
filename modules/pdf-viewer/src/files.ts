// The files a PDF Viewer keeps for one workspace, as the `files` document holds them, and the pure steps that change it.
// Every step runs again on a newer copy after a conflict (see `openDocument`), so each one is safe to repeat.

import { BLOB_TYPES } from "@tavora/sdk";

export const FILES_ID = "files";
/** The longest display name a file can have. */
export const NAME_LIMIT = 120;
/** Zoom of a page or picture, 1 = 100 %. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;

export type FileKind = "pdf" | "image";
/** How a file is fitted: to the width of the panel, to the whole page or picture, or by a zoom of its own (null). */
export type FitMode = "width" | "page" | null;

/** Where the reader was, remembered per file. `page` counts from 1 and means nothing for a picture. */
export interface FileView {
  page: number;
  zoom: number;
  fit: FitMode;
}

export interface FileEntry {
  /** The id of the stored file; also what a tab is called. */
  id: string;
  name: string;
  /** The type the host found by looking at the file. */
  type: string;
  kind: FileKind;
  addedAt: string;
  view: FileView;
}

export interface FilesData {
  files: FileEntry[];
}

export const emptyFiles = (): FilesData => ({ files: [] });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export const kindOf = (type: string): FileKind => (type === "application/pdf" ? "pdf" : "image");

export function clampZoom(zoom: number): number {
  return Number.isFinite(zoom) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) : 1;
}

/** A display name that fits: trimmed and cut to the limit. */
export function cleanName(name: string): string {
  return name.trim().slice(0, NAME_LIMIT);
}

export function parseView(raw: unknown, kind: FileKind): FileView {
  const value = isRecord(raw) ? raw : {};
  const page = typeof value.page === "number" && Number.isFinite(value.page) ? Math.max(1, Math.floor(value.page)) : 1;
  const zoom = typeof value.zoom === "number" ? clampZoom(value.zoom) : 1;
  const fit: FitMode = value.fit === "width" || value.fit === "page" || value.fit === null ? value.fit : kind === "pdf" ? "width" : "page";
  return { page, zoom, fit };
}

export function parseFiles(raw: unknown): FilesData {
  const list = isRecord(raw) && Array.isArray(raw.files) ? raw.files : [];
  const seen = new Set<string>();
  const files: FileEntry[] = [];
  for (const item of list) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id || seen.has(item.id)) continue;
    if (typeof item.type !== "string" || !(BLOB_TYPES as readonly string[]).includes(item.type)) continue;
    seen.add(item.id);
    const kind = kindOf(item.type);
    files.push({
      id: item.id,
      name: typeof item.name === "string" && item.name.trim() ? cleanName(item.name) : item.id.slice(0, 8),
      type: item.type,
      kind,
      addedAt: typeof item.addedAt === "string" ? item.addedAt : "",
      view: parseView(item.view, kind),
    });
  }
  return { files };
}

// ── Changes (all safe to repeat)

/** Adds a file at the end; one that is already there (the same stored file) is left as it is. */
export function addFile(data: FilesData, entry: FileEntry): void {
  if (!data.files.some((file) => file.id === entry.id)) data.files.push(entry);
}

export function renameFile(data: FilesData, id: string, name: string): void {
  const file = data.files.find((other) => other.id === id);
  const next = cleanName(name);
  if (file && next) file.name = next;
}

export function removeFile(data: FilesData, id: string): void {
  data.files = data.files.filter((file) => file.id !== id);
}

/** Remembers where the reader was. Anything that is not given stays as it is. */
export function setFileView(data: FilesData, id: string, view: Partial<FileView>): void {
  const file = data.files.find((other) => other.id === id);
  if (!file) return;
  file.view = parseView({ ...file.view, ...view }, file.kind);
}

// ── Telling what the user gave us

const TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** What `accept` allows in the file picker: the types and the extensions (a few systems send no type). */
export const ACCEPT_ATTRIBUTE = [...BLOB_TYPES, ...Object.keys(TYPE_BY_EXTENSION).map((extension) => `.${extension}`)].join(",");

/**
 * The type of a picked or dropped file: its own type when we store that, else (no type, or a generic one) from its
 * extension. Null for anything else. The host looks at the bytes again and has the last word.
 */
export function detectType(file: { name: string; type: string }): string | null {
  const type = file.type.toLowerCase();
  if ((BLOB_TYPES as readonly string[]).includes(type)) return type;
  if (type === "image/jpg") return "image/jpeg";
  if (type && type !== "application/octet-stream") return null;
  const dot = file.name.lastIndexOf(".");
  return dot < 0 ? null : (TYPE_BY_EXTENSION[file.name.slice(dot + 1).toLowerCase()] ?? null);
}

/** Splits a drop or a pick into the positions we can show and the names of the files we cannot. */
export function sortPicked(files: readonly { name: string; type: string }[]): { accepted: number[]; refused: string[] } {
  const accepted: number[] = [];
  const refused: string[] = [];
  files.forEach((file, index) => (detectType(file) ? accepted.push(index) : refused.push(file.name)));
  return { accepted, refused };
}

/** A file's size as a short text, such as "1.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
