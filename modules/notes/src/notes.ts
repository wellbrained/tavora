// The data side of Notes: what a stored note looks like and the pure rules
// for titles, sorting and search. Kept free of Vue and Tiptap so it can be
// unit tested.

import type { JsonValue } from "@tavora/sdk";

/** The one note every game has. It cannot be deleted, only cleared. */
export const SCRATCHPAD_ID = "scratchpad";
export const SCRATCHPAD_TITLE = "Scratchpad";
export const UNTITLED = "Untitled note";
/** Titles are shown in one line; the host allows up to 200 characters. */
const MAX_TITLE = 80;

/** A Tiptap (ProseMirror) document as JSON. */
export type RichText = { type: "doc"; content?: JsonValue[] } & { [key: string]: JsonValue };

/** What Notes stores in each document. */
export interface NoteData {
  [key: string]: JsonValue;
  version: 1;
  content: RichText;
  /** Plain text of the content, for search and the list preview. */
  text: string;
  pinned: boolean;
  createdAt: string;
}

/** A note as the list shows it. */
export interface NoteEntry {
  id: string;
  title: string;
  /** Plain text, for search and the preview line. */
  text: string;
  pinned: boolean;
  updatedAt: string;
  revision: number;
}

export function emptyContent(): RichText {
  return { type: "doc", content: [{ type: "paragraph" }] };
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
    pinned: value.pinned === true,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
  };
}

/** A note's title is its first line, like a paper notebook. */
export function titleFor(id: string, text: string): string {
  if (id === SCRATCHPAD_ID) return SCRATCHPAD_TITLE;
  // Markdown typed or pasted without being turned into formatting is left out.
  const line = text
    .split("\n")
    .map((part) => part.trim().replace(/^(#{1,6}|[-*+>]|\[[ xX]?\]|\d+[.)])\s+/, "").trim())
    .find(Boolean);
  if (!line) return UNTITLED;
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1).trimEnd()}…` : line;
}

/** The text after the title line, for the second line in the list. */
export function previewFor(entry: Pick<NoteEntry, "id" | "text">): string {
  const lines = entry.text
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean);
  return (entry.id === SCRATCHPAD_ID ? lines : lines.slice(1)).join(" ").slice(0, 160);
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
 * the rest, each newest first. The scratchpad is always there, saved or not.
 */
export function sections(entries: Iterable<NoteEntry>): NoteSections {
  let scratchpad: NoteEntry = {
    id: SCRATCHPAD_ID,
    title: SCRATCHPAD_TITLE,
    text: "",
    pinned: false,
    updatedAt: "",
    revision: 0,
  };
  const pinned: NoteEntry[] = [];
  const others: NoteEntry[] = [];
  for (const entry of entries) {
    if (entry.id === SCRATCHPAD_ID) scratchpad = entry;
    else (entry.pinned ? pinned : others).push(entry);
  }
  const newestFirst = (a: NoteEntry, b: NoteEntry) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
  return { scratchpad, pinned: pinned.sort(newestFirst), others: others.sort(newestFirst) };
}

/** "Just now", "5 min ago", "Yesterday", or a date, for the list. */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const date = new Date(then);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (then >= startOfToday) return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (then >= startOfToday - 86_400_000) return "Yesterday";
  return date.toLocaleDateString(undefined, {
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
