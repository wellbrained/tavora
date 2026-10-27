// The data side of Notes: what a stored note looks like and the pure rules
// for titles, sorting and search. Kept free of Vue and Tiptap so it can be
// unit tested.

import { BLOB_ID, type JsonValue } from "@tavora/sdk";

/** The one note every workspace has. It cannot be deleted, only cleared. */
export const SCRATCHPAD_ID = "scratchpad";
export const SCRATCHPAD_TITLE = "Scratchpad";
/** The document that remembers the order the user put the notes in. It is not a note. */
export const ORDER_ID = "order";
export const UNTITLED = "Untitled note";
/** Titles are shown in one line; the host allows up to 200 characters. */
const MAX_TITLE = 80;
/** The longest title a note can be given by hand. */
export const MAX_FIXED_TITLE = 120;

/** A Tiptap (ProseMirror) document as JSON. */
export type RichText = { type: "doc"; content?: JsonValue[] } & { [key: string]: JsonValue };

/** What Notes stores in each document. */
export interface NoteData {
  [key: string]: JsonValue;
  version: 1;
  content: RichText;
  /** Plain text of the content, for search and the list preview. */
  text: string;
  /** A title set by hand; empty means the first line is the title. */
  title: string;
  /** Ids of the pictures in the content (see blobs), so unused ones can be found without opening every note. */
  images: string[];
  pinned: boolean;
  createdAt: string;
}

/** A note as the list shows it. */
export interface NoteEntry {
  id: string;
  title: string;
  /** Plain text, for search and the preview line. */
  text: string;
  /** The title set by hand, empty when the title comes from the first line. */
  fixedTitle: string;
  /** Ids of the pictures in the note. */
  images: string[];
  pinned: boolean;
  /** When the note was made; the list keeps notes in this order, oldest first. */
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export function emptyContent(): RichText {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

/** A title typed by hand: one line, trimmed and kept to a sensible length. */
export function cleanTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_FIXED_TITLE).trimEnd();
}

/** The ids of the pictures in a document, in order and without repeats. */
export function collectImageIds(content: JsonValue): string[] {
  const ids = new Set<string>();
  const visit = (node: JsonValue): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type === "image") {
      const attrs = node.attrs;
      const id = attrs !== null && typeof attrs === "object" && !Array.isArray(attrs) ? attrs.blobId : undefined;
      if (typeof id === "string" && BLOB_ID.test(id)) ids.add(id);
    }
    visit(node.content ?? null);
  };
  visit(content);
  return [...ids];
}

/** Bytes as megabytes for the Images menu: one decimal under 10 MB, none above. */
export function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Turns stored data into a valid note, whatever an older version or a bad write left there. */
export function parseNote(raw: JsonValue | null, now = new Date().toISOString()): NoteData {
  const value = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const content = value.content;
  return {
    version: 1,
    content:
      content !== null && typeof content === "object" && !Array.isArray(content) && content.type === "doc"
        ? (content as RichText)
        : emptyContent(),
    text: typeof value.text === "string" ? value.text : "",
    title: typeof value.title === "string" ? cleanTitle(value.title) : "",
    images: Array.isArray(value.images) ? value.images.filter((id): id is string => typeof id === "string" && BLOB_ID.test(id)) : [],
    pinned: value.pinned === true,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
  };
}

/** The note's plain text as paragraphs, shown when its stored formatting cannot be read. */
export function contentFromText(text: string): RichText {
  const lines = text.split(/\r?\n/).slice(0, 5000);
  return {
    type: "doc",
    content: lines.map((line): JsonValue => (line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" })),
  };
}

/** A note's title is the one set by hand, or else its first line, like a paper notebook. */
export function titleFor(id: string, text: string, fixed = ""): string {
  if (id === SCRATCHPAD_ID) return SCRATCHPAD_TITLE;
  if (fixed) return fixed;
  // Markdown typed or pasted without being turned into formatting is left out.
  const line = text
    .split("\n")
    .map((part) => part.trim().replace(/^(#{1,6}|[-*+>]|\[[ xX]?\]|\d+[.)])\s+/, "").trim())
    .find(Boolean);
  if (!line) return UNTITLED;
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1).trimEnd()}…` : line;
}

/** The text after the title line, for the second line in the list. A title set by hand leaves all the text. */
export function previewFor(entry: Pick<NoteEntry, "id" | "text" | "fixedTitle">): string {
  const lines = entry.text
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean);
  return (entry.id === SCRATCHPAD_ID || entry.fixedTitle ? lines : lines.slice(1)).join(" ").slice(0, 160);
}

/** Every word of the query must appear in the title or text, in any order and case. */
export function matches(entry: Pick<NoteEntry, "title" | "text">, query: string): boolean {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = `${entry.title}\n${entry.text}`.toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}

export interface NoteSections {
  scratchpad: NoteEntry;
  pinned: NoteEntry[];
  others: NoteEntry[];
}

/**
 * Splits notes for the list: the scratchpad first, then pinned notes, then
 * the rest. Notes the user has put in an order (`order`) come first in that
 * order; the others follow in the order they were made, so a new note comes
 * last and editing never moves one. The scratchpad is always there, saved or not.
 */
export function sections(entries: Iterable<NoteEntry>, order: readonly string[] = []): NoteSections {
  let scratchpad: NoteEntry = {
    id: SCRATCHPAD_ID,
    title: SCRATCHPAD_TITLE,
    text: "",
    fixedTitle: "",
    images: [],
    pinned: false,
    updatedAt: "",
    revision: 0,
    createdAt: "",
  };
  const pinned: NoteEntry[] = [];
  const others: NoteEntry[] = [];
  for (const entry of entries) {
    if (entry.id === SCRATCHPAD_ID) scratchpad = entry;
    else (entry.pinned ? pinned : others).push(entry);
  }
  const rank = new Map(order.map((id, index) => [id, index]));
  const inOrder = (a: NoteEntry, b: NoteEntry) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  };
  return { scratchpad, pinned: pinned.sort(inOrder), others: others.sort(inOrder) };
}

/** The order to store after `id` is dropped before or after `target`; null when the two are not in the same group (pinned or not) or nothing changes. */
export function reordered(entries: Iterable<NoteEntry>, order: readonly string[], id: string, target: string, after: boolean): string[] | null {
  const { pinned, others } = sections(entries, order);
  const group = [pinned, others].find((list) => list.some((entry) => entry.id === id));
  if (!group || id === target || !group.some((entry) => entry.id === target)) return null;
  const ids = group.map((entry) => entry.id).filter((other) => other !== id);
  ids.splice(ids.indexOf(target) + (after ? 1 : 0), 0, id);
  if (ids.join() === group.map((entry) => entry.id).join()) return null;
  const rest = (group === pinned ? others : pinned).map((entry) => entry.id);
  return group === pinned ? [...ids, ...rest] : [...rest, ...ids];
}

/** The order to store after `id` moves one place up (-1) or down (1) within its group; null at the ends. */
export function nudged(entries: Iterable<NoteEntry>, order: readonly string[], id: string, delta: -1 | 1): string[] | null {
  const { pinned, others } = sections(entries, order);
  const group = [pinned, others].find((list) => list.some((entry) => entry.id === id));
  const index = group?.findIndex((entry) => entry.id === id) ?? -1;
  const neighbour = group?.[index + delta];
  return neighbour ? reordered(entries, order, id, neighbour.id, delta === 1) : null;
}

/** Reads the stored order; anything that is not a list of ids is ignored. */
export function parseOrder(raw: JsonValue | null): string[] {
  const ids = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw.ids : null;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/** The words relativeTime uses, and the locale for dates and times. */
export interface TimeWords {
  justNow: string;
  minutes(count: number): string;
  yesterday: string;
  locale: string | undefined;
}

const ENGLISH: TimeWords = { justNow: "Just now", minutes: (count) => `${count} min ago`, yesterday: "Yesterday", locale: undefined };

/** "Just now", "5 min ago", "Yesterday", or a date, for the list. */
export function relativeTime(iso: string, now = Date.now(), words: TimeWords = ENGLISH): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return words.justNow;
  if (minutes < 60) return words.minutes(minutes);
  const date = new Date(then);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (then >= startOfToday) return date.toLocaleTimeString(words.locale, { hour: "2-digit", minute: "2-digit" });
  if (then >= startOfToday - 86_400_000) return words.yesterday;
  return date.toLocaleDateString(words.locale, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Only web and mail links can be added; anything else is refused. */
export function normalizeLink(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

// ── Text appearance ──────────────────────────────────────────────────

/** The fonts for note text, all bundled with the module so they work offline. */
export const FONTS = [
  { id: "inter", name: "Inter", stack: '"Inter Variable", system-ui, sans-serif' },
  { id: "open-sans", name: "Open Sans", stack: '"Open Sans Variable", system-ui, sans-serif' },
  { id: "lora", name: "Lora", stack: '"Lora Variable", Georgia, serif' },
  { id: "merriweather", name: "Merriweather", stack: '"Merriweather Variable", Georgia, serif' },
  { id: "jetbrains-mono", name: "JetBrains Mono", stack: '"JetBrains Mono Variable", ui-monospace, monospace' },
] as const;
export type FontId = (typeof FONTS)[number]["id"];

/** Text sizes in CSS pixels; Medium is the size notes always had. */
export const SIZES = [
  { id: "small", px: 13 },
  { id: "medium", px: 14 },
  { id: "large", px: 16 },
  { id: "xlarge", px: 19 },
] as const;
export type SizeId = (typeof SIZES)[number]["id"];

export interface TextStyle {
  font: FontId;
  size: SizeId;
}

/** The look of the text in notes, and separately in the scratchpad. */
export interface Appearance {
  notes: TextStyle;
  scratchpad: TextStyle;
}

export const DEFAULT_STYLE: TextStyle = { font: "inter", size: "medium" };

export function fontStack(id: FontId): string {
  return FONTS.find((font) => font.id === id)?.stack ?? FONTS[0].stack;
}

export function sizePx(id: SizeId): number {
  return SIZES.find((size) => size.id === id)?.px ?? 14;
}

function parseStyle(raw: JsonValue | undefined): TextStyle {
  const value = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    font: FONTS.find((font) => font.id === value.font)?.id ?? DEFAULT_STYLE.font,
    size: SIZES.find((size) => size.id === value.size)?.id ?? DEFAULT_STYLE.size,
  };
}

/** Turns what was stored into a valid appearance; unknown fonts and sizes fall back to the defaults. */
export function parseAppearance(raw: JsonValue | null): Appearance {
  const value = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return { notes: parseStyle(value.notes), scratchpad: parseStyle(value.scratchpad) };
}
