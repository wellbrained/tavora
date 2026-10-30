// The files a PDF Viewer keeps for one workspace, as the `files` document holds them, and the pure steps that change it.
// Every step runs again on a newer copy after a conflict (see `openDocument`), so each one is safe to repeat.

import { BLOB_TYPES, type ReadOnlyFileState } from "@tavora/sdk";

export const FILES_ID = "files";
/** The longest display name a file can have. */
export const NAME_LIMIT = 120;
/** Zoom of a page or picture, 1 = 100 %. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;

export type FileKind = "pdf" | "image";
/** How a file is fitted: to the width of the panel, to the whole page or picture, or by a zoom of its own (null). */
export type FitMode = "width" | "page" | null;
/** What the side of a PDF shows: small pictures of its pages, its contents, or nothing. */
export type SideMode = "pages" | "contents" | null;

/** Where the reader was, remembered per file. `page` counts from 1 and means nothing for a picture. */
export interface FileView {
  page: number;
  zoom: number;
  fit: FitMode;
  side: SideMode;
}

/**
 * The original a file was copied from, when it was picked through Tavora's open dialog. Tavora keeps where it is; the
 * module only has `ref`, which works on the PC that picked it. `size` and `modifiedAt` are what the copy was made from.
 */
export interface FileLink {
  ref: string;
  size: number;
  modifiedAt: number;
  /** The version of the original whose "reload?" the user said Not now to (see `versionOf`). */
  skipped?: string;
}

/** What a check of the original found: nothing new, a newer version, a newer one the user skipped, it's gone, or it isn't linked on this PC. */
export type LinkStatus = "same" | "changed" | "skipped" | "gone" | "unlinked";

export interface FileEntry {
  /** What the file and its tab are called; the id of its first stored copy. */
  id: string;
  /** The stored copy, when a reload replaced the first one. */
  blob?: string;
  link?: FileLink;
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
  const side: SideMode = value.side === "pages" || value.side === "contents" ? value.side : null;
  return { page, zoom, fit, side };
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function parseLink(raw: unknown): FileLink | undefined {
  if (!isRecord(raw) || typeof raw.ref !== "string" || !/^[a-f0-9]{32}$/.test(raw.ref) || !isCount(raw.size) || !isCount(raw.modifiedAt)) return undefined;
  return { ref: raw.ref, size: raw.size, modifiedAt: raw.modifiedAt, ...(typeof raw.skipped === "string" ? { skipped: raw.skipped } : {}) };
}

/** The stored copy a file shows. */
export const blobOf = (file: FileEntry): string => file.blob ?? file.id;

/** One version of an original, as a short text to compare. */
export const versionOf = (found: { size: number; modifiedAt: number }): string => `${found.size}:${found.modifiedAt}`;

export function linkStatus(link: FileLink, state: ReadOnlyFileState): LinkStatus {
  if (!state.found) return state.reason;
  const version = versionOf(state);
  if (version === versionOf(link)) return "same";
  return version === link.skipped ? "skipped" : "changed";
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
    const link = parseLink(item.link);
    files.push({
      id: item.id,
      ...(typeof item.blob === "string" && item.blob && item.blob !== item.id ? { blob: item.blob } : {}),
      ...(link ? { link } : {}),
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

/** A reload put a new copy in place: the file shows it, and the link remembers the version it came from. */
export function replaceCopy(data: FilesData, id: string, blob: string, type: string, link: FileLink): void {
  const file = data.files.find((other) => other.id === id);
  if (!file) return;
  if (blob === file.id) delete file.blob;
  else file.blob = blob;
  file.type = type;
  file.kind = kindOf(type);
  file.link = { ref: link.ref, size: link.size, modifiedAt: link.modifiedAt };
}

/** Not now: this version of the original asks no more. */
export function skipVersion(data: FilesData, id: string, version: string): void {
  const file = data.files.find((other) => other.id === id);
  if (file?.link) file.link.skipped = version;
}

/** Keep my copy: the file stays and forgets its original. */
export function dropLink(data: FilesData, id: string): void {
  const file = data.files.find((other) => other.id === id);
  if (file) delete file.link;
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

/** The extensions Tavora's open dialog offers. */
export const PICK_EXTENSIONS = Object.keys(TYPE_BY_EXTENSION);

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
