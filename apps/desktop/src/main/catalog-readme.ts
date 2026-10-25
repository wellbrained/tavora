// Turns a module's readme into plain text blocks for its page in the catalog (C10). Tavora reads only the
// shape of a Markdown file: headings, paragraphs, lists (one level of nesting) and code, and inside a
// line bold, italic, inline code and links as typed spans. Everything is text the host UI shows as text,
// never as HTML. A link keeps its address only when it is http or https; pictures and HTML are never
// loaded or run, and anything else stays as the characters it is.
import type { ReadmeBlock, ReadmeItem, ReadmeSpan } from "../shared/host-api";
import { isWebUrl } from "./browser-url";

/** Most blocks and characters one readme is shown with; the rest is left out. */
export const MAX_README_BLOCKS = 200;
export const MAX_README_CHARS = 20 * 1024;
const MAX_LIST_ITEMS = 50;
const MAX_CHILDREN = 20;
/** Most links one readme keeps; later ones show their words only. */
export const MAX_README_LINKS = 100;
const MAX_URL = 2000;

/** Text that could change how the text around it reads: controls and direction marks. */
const HIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;
const NOT_PLAIN_URL = /[\s\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/;

type Style = Omit<ReadmeSpan, "text">;

// One token of a line: `code`, [words](address), **bold** / __bold__, then *italic* / _italic_.
const TOKEN =
  /`([^`]+)`|\[([^\]]+)\]\(\s*((?:[^()\s]|\([^()]*\))*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)|(\*\*|__)(?=\S)(.+?)(?<=\S)\4|(?<![\w*])([*_])(?=\S)(.+?)(?<=\S)\6(?![\w*])/g;

/** The address of a link when it is a plain http or https one a click may open; null for anything else. */
function linkUrl(raw: string): string | null {
  if (raw.length > MAX_URL || !/^https?:\/\//i.test(raw) || NOT_PLAIN_URL.test(raw)) return null;
  return isWebUrl(raw) ? raw : null;
}

function inlineSpans(text: string, style: Style, links: { left: number }): ReadmeSpan[] {
  const out: ReadmeSpan[] = [];
  const plain = (value: string) => {
    if (value) out.push({ text: value, ...style });
  };
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    plain(text.slice(at, match.index));
    at = match.index + match[0].length;
    if (match[1] !== undefined) out.push({ text: match[1], ...style, code: true });
    else if (match[2] !== undefined) {
      const url = style.url === undefined ? linkUrl(match[3] ?? "") : null;
      const linked = url !== null && links.left > 0;
      if (linked) links.left--;
      out.push(...inlineSpans(match[2], linked ? { ...style, url } : style, links));
    } else if (match[5] !== undefined) out.push(...inlineSpans(match[5], { ...style, bold: true }, links));
    else out.push(...inlineSpans(match[7]!, { ...style, italic: true }, links));
  }
  plain(text.slice(at));
  return out;
}

/** Spans of one Markdown line: pictures as their words, markup as typed spans, whitespace collapsed. */
export function parseInline(text: string, links: { left: number } = { left: MAX_README_LINKS }): ReadmeSpan[] {
  const cleaned = text
    .replace(HIDDEN, "")
    .replace(/!\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");
  const merged: ReadmeSpan[] = [];
  for (const span of inlineSpans(cleaned, {}, links)) {
    const words = span.text.replace(/\s+/g, " ");
    const last = merged[merged.length - 1];
    if (last && last.bold === span.bold && last.italic === span.italic && last.code === span.code && last.url === span.url) last.text += words;
    else merged.push({ ...span, text: words });
  }
  if (merged.length) {
    merged[0]!.text = merged[0]!.text.trimStart();
    merged[merged.length - 1]!.text = merged[merged.length - 1]!.text.trimEnd();
  }
  return merged.filter((span) => span.text !== "");
}

/** The words of spans, with no marks. */
export const spansText = (spans: readonly ReadmeSpan[]): string => spans.map((span) => span.text).join("");

/** The words of a Markdown line: no pictures, links as their words, emphasis and code marks dropped. */
export function plainInline(text: string): string {
  return spansText(parseInline(text));
}

/** Every address a click on this readme may open, as parseReadme keeps them. */
export function readmeLinks(blocks: readonly ReadmeBlock[]): Set<string> {
  const urls = new Set<string>();
  const add = (spans: readonly ReadmeSpan[]) => {
    for (const span of spans) if (span.url) urls.add(span.url);
  };
  for (const block of blocks) {
    if (block.kind === "paragraph") add(block.spans);
    else if (block.kind === "list")
      for (const item of block.items) {
        add(item.spans);
        item.children?.forEach(add);
      }
  }
  return urls;
}

/** Whether a link click may open `url`: it must be an address the module's current readme shows as a link. */
export function readmeAllowsLink(readme: string | null, url: unknown): boolean {
  return readme !== null && typeof url === "string" && linkUrl(url) === url && readmeLinks(parseReadme(readme)).has(url);
}

interface PendingList {
  ordered: boolean;
  items: { text: string; children: string[] }[];
}

export function parseReadme(source: string): ReadmeBlock[] {
  const blocks: ReadmeBlock[] = [];
  const lines = source.slice(0, MAX_README_CHARS).replace(/\r\n?/g, "\n").split("\n");
  const links = { left: MAX_README_LINKS };
  let paragraph: string[] = [];
  let list: PendingList | null = null;
  let code: string[] | null = null;

  const push = (block: ReadmeBlock) => {
    if (blocks.length < MAX_README_BLOCKS) blocks.push(block);
  };
  const flush = () => {
    const spans = parseInline(paragraph.join(" "), links);
    if (spans.length) push({ kind: "paragraph", spans });
    paragraph = [];
    if (list) {
      const items: ReadmeItem[] = [];
      for (const item of list.items) {
        const spans = parseInline(item.text, links);
        if (!spans.length) continue;
        const children = item.children
          .slice(0, MAX_CHILDREN)
          .map((child) => parseInline(child, links))
          .filter((child) => child.length > 0);
        items.push(children.length ? { spans, children } : { spans });
      }
      if (items.length) push({ kind: "list", ordered: list.ordered, items: items.slice(0, MAX_LIST_ITEMS) });
      list = null;
    }
  };

  for (const line of lines) {
    if (code) {
      if (/^\s*(```|~~~)/.test(line)) {
        push({ kind: "code", text: code.join("\n").replace(HIDDEN, "") });
        code = null;
      } else code.push(line);
      continue;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      code = [];
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const text = plainInline(heading[2]!);
      if (text) push({ kind: "heading", level: Math.min(heading[1]!.length, 3) as 1 | 2 | 3, text });
      continue;
    }
    const item = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line);
    if (item) {
      const indent = item[1]!.replace(/\t/g, "    ").length;
      const ordered = /\d/.test(item[2]!);
      if (list && indent >= 2 && list.items.length) {
        // One level only: deeper items join the same item's children.
        list.items[list.items.length - 1]!.children.push(item[3]!);
        continue;
      }
      if (paragraph.length || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push({ text: item[3]!, children: [] });
      continue;
    }
    if (!line.trim() || /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line) || /^\s*<!--.*-->\s*$/.test(line)) {
      flush();
      continue;
    }
    // A line under a list item that is indented carries on that item (or its last child).
    if (list && /^\s+\S/.test(line)) {
      const last = list.items[list.items.length - 1]!;
      if (last.children.length) last.children[last.children.length - 1] += ` ${line.trim()}`;
      else last.text += ` ${line.trim()}`;
      continue;
    }
    if (list) flush();
    paragraph.push(line.replace(/^\s*>\s?/, ""));
  }
  if (code) push({ kind: "code", text: code.join("\n").replace(HIDDEN, "") });
  flush();
  return blocks;
}
