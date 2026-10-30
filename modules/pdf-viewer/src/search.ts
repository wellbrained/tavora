// Searching the text of a PDF. A page's text is its text items joined (a line break becomes a space), so a match
// is a page and a range of that text; `segmentsFor` cuts one text item's string where matches begin and end.

export interface TextPiece {
  str: string;
  hasEOL?: boolean;
}

export interface PageText {
  text: string;
  /** Where each item starts in `text`. */
  starts: number[];
}

export interface Range {
  start: number;
  end: number;
}

export interface Match extends Range {
  /** 1-based page number. */
  page: number;
}

export function buildPageText(items: readonly TextPiece[]): PageText {
  let text = "";
  const starts: number[] = [];
  for (const item of items) {
    starts.push(text.length);
    text += item.str + (item.hasEOL ? " " : "");
  }
  return { text, starts };
}

/** Every place `query` is in `text` (no overlaps), ignoring case. An empty query finds nothing. */
export function findRanges(text: string, query: string): Range[] {
  const wanted = query.trim();
  if (!wanted) return [];
  const lowerText = text.toLowerCase();
  const lowerWanted = wanted.toLowerCase();
  // Lower-casing a few letters changes the length, and the offsets would no longer fit the text: match it as it is then.
  const [source, needle] = lowerText.length === text.length && lowerWanted.length === wanted.length ? [lowerText, lowerWanted] : [text, wanted];
  const found: Range[] = [];
  for (let at = source.indexOf(needle); at >= 0; at = source.indexOf(needle, at + needle.length)) found.push({ start: at, end: at + needle.length });
  return found;
}

/** All matches of the query across the pages, in reading order. `texts[0]` is page 1. */
export function findMatches(texts: readonly string[], query: string): Match[] {
  return texts.flatMap((text, index) => findRanges(text, query).map((range) => ({ page: index + 1, ...range })));
}

/** The match after (1) or before (-1) the current one, wrapping around; -1 when there are none. */
export function stepMatch(current: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}

/** The match to start at: the first one on or after `page`, else the first; -1 when there are none. */
export function firstMatchFrom(matches: readonly Match[], page: number): number {
  const at = matches.findIndex((match) => match.page >= page);
  return matches.length === 0 ? -1 : Math.max(at, 0);
}

export interface Segment {
  text: string;
  /** The part is a match; `current` when it is the one the reader is on. */
  mark?: "match" | "current";
}

/**
 * One text item cut into plain and marked parts. `matches` are ranges in the page's text, `itemStart` is where the
 * item starts there and `current` is the range of the match the reader is on (or null).
 */
export function segmentsFor(str: string, itemStart: number, matches: readonly Range[], current: Range | null): Segment[] {
  const itemEnd = itemStart + str.length;
  const segments: Segment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.end <= itemStart || match.start >= itemEnd) continue;
    const from = Math.max(match.start, itemStart) - itemStart;
    const to = Math.min(match.end, itemEnd) - itemStart;
    if (from > cursor) segments.push({ text: str.slice(cursor, from) });
    const isCurrent = current !== null && current.start === match.start && current.end === match.end;
    segments.push({ text: str.slice(from, to), mark: isCurrent ? "current" : "match" });
    cursor = to;
  }
  if (cursor < str.length) segments.push({ text: str.slice(cursor) });
  return segments.length ? segments : [{ text: str }];
}
