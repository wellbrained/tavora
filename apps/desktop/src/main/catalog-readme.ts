// Turns a catalog module's readme into plain text blocks for its page in the catalog (C10). Tavora reads
// only the shape of a Markdown file: headings, paragraphs, lists and code. Every block is plain text the
// host UI shows as text; links keep only their words, pictures and HTML are never loaded or run, and
// anything else stays as the characters it is.
import type { ReadmeBlock } from "../shared/host-api";

/** Most blocks and characters one readme is shown with; the rest is left out. */
export const MAX_README_BLOCKS = 200;
export const MAX_README_CHARS = 20 * 1024;
const MAX_LIST_ITEMS = 50;

/** Text that could change how the text around it reads: controls and direction marks. */
const HIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/** The words of a Markdown line: no pictures, links as their words, emphasis and code marks dropped. */
export function plainInline(text: string): string {
  return text
    .replace(HIDDEN, "")
    .replace(/!\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, "$1")
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/(?<![\w*])([*_])(?=\S)(.+?)(?<=\S)\1(?![\w*])/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseReadme(source: string): ReadmeBlock[] {
  const blocks: ReadmeBlock[] = [];
  const lines = source.slice(0, MAX_README_CHARS).replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;

  const push = (block: ReadmeBlock) => {
    if (blocks.length < MAX_README_BLOCKS) blocks.push(block);
  };
  const flush = () => {
    const text = plainInline(paragraph.join(" "));
    if (text) push({ kind: "paragraph", text });
    paragraph = [];
    if (list) {
      const items = list.items.map(plainInline).filter(Boolean).slice(0, MAX_LIST_ITEMS);
      if (items.length) push({ kind: "list", ordered: list.ordered, items });
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
      if (text) push({ kind: "heading", level: heading[1]!.length <= 2 ? 2 : 3, text });
      continue;
    }
    const item = /^\s{0,3}([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line);
    if (item) {
      const ordered = /\d/.test(item[1]!);
      if (paragraph.length || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push(item[2]!);
      continue;
    }
    if (!line.trim() || /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line) || /^\s*<!--.*-->\s*$/.test(line)) {
      flush();
      continue;
    }
    // A line under a list item that is indented carries on that item.
    if (list && /^\s+\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (list) flush();
    paragraph.push(line.replace(/^\s*>\s?/, ""));
  }
  if (code) push({ kind: "code", text: code.join("\n").replace(HIDDEN, "") });
  flush();
  return blocks;
}
