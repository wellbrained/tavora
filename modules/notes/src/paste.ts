// What a paste can bring that the editor must not take as it is: a whiteboard's copy (Excalidraw puts its pictures on
// the clipboard as text, each one a base64 data: URL), or a very long text. Tiptap's link finder (linkifyjs) needs
// seconds for 0.5 MB of text without spaces and a minute for 2 MB, and runs on every paste and on the last word before
// each space or Enter: a pasted picture's text froze the page. Kept free of Vue so it can be unit tested.

import { combineTransactionSteps, Extension, getChangedRanges } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { clipboardHasText, isAcceptedType } from "./images";
import { isRecord } from "@tavora/official-ui/lib/utils";

/** Longer text is pasted as plain paragraphs, without looking for links or Markdown in it. */
export const PLAIN_PASTE_CHARS = 100_000;
/** Longer text is not pasted: a note this long can't be saved (the host keeps a note to 4 MB, its text counted twice). */
export const MAX_PASTE_CHARS = 500_000;
/** In a paragraph longer than this, typing doesn't turn web addresses into links (the finder would read all of it). */
export const LONG_TEXTBLOCK = 20_000;
/**
 * A word (characters without a space) at least this long is not searched for links: the finder is about quadratic on
 * dotted text (`a.a.a…`, minified code), 1 s for 20k characters, while 2k take about 10 ms. Real addresses are shorter.
 */
export const LONG_WORD = 2_000;

/** Whether the text has a run of at least `min` characters without whitespace. Linear, unlike /\S{2000,}/. */
export function hasLongWord(text: string, min = LONG_WORD): boolean {
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Space, tab, line breaks and the no-break space split words for the link finder.
    if (code === 32 || (code >= 9 && code <= 13) || code === 160) run = 0;
    else if (++run >= min) return true;
  }
  return false;
}

/** The pictures and texts of a whiteboard's copy, in the order they were drawn. */
export interface WhiteboardClip {
  pictures: File[];
  /** The texts on the board, one paragraph each. */
  texts: string[];
}

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" };

/** A picture from a base64 data: URL, or null when it isn't one. */
export function fileFromDataUrl(dataUrl: string, name: string): File | null {
  const match = /^data:([\w.+-]+\/[\w.+-]+)(?:;[^,;]*)*;base64,/i.exec(dataUrl);
  if (!match?.[1]) return null;
  let binary: string;
  try {
    binary = atob(dataUrl.slice(match[0].length));
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const type = match[1].toLowerCase();
  return new File([bytes], `${name}.${EXTENSIONS[type] ?? "bin"}`, { type });
}

/** Reads Excalidraw's copy (Tavora's Whiteboard, excalidraw.com); null for any other text. */
export function readWhiteboardClip(text: string): WhiteboardClip | null {
  // Cheap test first: most pastes are not JSON at all.
  if (!/^\s*\{\s*"type"\s*:\s*"excalidraw\/clipboard"/.test(text)) return null;
  let clip: unknown;
  try {
    clip = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(clip) || clip.type !== "excalidraw/clipboard") return null;
  const elements = Array.isArray(clip.elements) ? clip.elements.filter(isRecord) : [];
  const files = isRecord(clip.files) ? clip.files : {};
  const pictures: File[] = [];
  const texts: string[] = [];
  const seen = new Set<string>();
  const add = (fileId: string) => {
    const file = files[fileId];
    if (seen.has(fileId) || !isRecord(file) || typeof file.dataURL !== "string") return;
    seen.add(fileId);
    const picture = fileFromDataUrl(file.dataURL, `picture-${pictures.length + 1}`);
    // Only kinds a note can hold (no SVG or HTML): the others would each bring a "not supported" message.
    if (picture && isAcceptedType(picture.type)) pictures.push(picture);
  };
  for (const element of elements) {
    if (element.isDeleted === true) continue;
    if (element.type === "image" && typeof element.fileId === "string") add(element.fileId);
    const words = typeof element.originalText === "string" ? element.originalText : element.text;
    if (element.type === "text" && typeof words === "string" && words.trim()) texts.push(words);
  }
  return { pictures, texts };
}

/** Puts text in at the cursor as plain paragraphs (or as is in a code block), without the paste's link and Markdown rules. */
export function insertPlainText(view: EditorView, text: string): void {
  const { state } = view;
  const { schema, selection } = state;
  const clean = text.replace(/\r\n?/g, "\n");
  const tr = selection.$from.parent.type.spec.code
    ? state.tr.insertText(clean)
    : state.tr.replaceSelection(
        new Slice(Fragment.from(clean.split("\n").map((line) => schema.nodes.paragraph!.create(null, line ? schema.text(line) : undefined))), 1, 1),
      );
  view.dispatch(tr.setMeta("preventAutolink", true).scrollIntoView());
}

/** What the paste needs from the editor around it. */
export interface PasteHost {
  /** Pasted files without text: the editor's picture paste. Returns whether it took them. */
  files(list: FileList | null | undefined): boolean;
  /** Stores pictures and puts them in at the cursor. */
  addImages(files: File[]): void;
  /** Shows the user a message (already in their language). */
  notice(message: string): void;
  /** The texts the paste may show. */
  texts: { tooLong: string; drawingOnly: string };
}

/** The note's paste: a whiteboard's pictures, long text as plain text, too long text refused. False leaves it to the editor. */
export function handleNotePaste(view: EditorView, event: ClipboardEvent, host: PasteHost): boolean {
  const data = event.clipboardData;
  // Excel and Word also put a picture of the selection on the clipboard: the text is what was copied.
  if (!clipboardHasText(data)) return host.files(data?.files);
  const text = data!.getData("text/plain");
  const clip = readWhiteboardClip(text);
  if (clip) {
    event.preventDefault();
    const words = clip.texts.join("\n");
    if (words.length > MAX_PASTE_CHARS) host.notice(host.texts.tooLong);
    else if (words) insertPlainText(view, words);
    if (clip.pictures.length) host.addImages(clip.pictures);
    else if (!words) host.notice(host.texts.drawingOnly);
    return true;
  }
  if (text.length > MAX_PASTE_CHARS) {
    event.preventDefault();
    host.notice(host.texts.tooLong);
    return true;
  }
  // Long text, or a word too long for the link finder, goes in plain. The HTML side isn't checked: a web page's copy
  // often carries its pictures as long data: URLs, which the editor drops quickly, and it should keep its formatting.
  if (text.length <= PLAIN_PASTE_CHARS && !hasLongWord(text)) return false;
  event.preventDefault();
  insertPlainText(view, text);
  return true;
}

/**
 * Whether a change touches a paragraph (or heading) longer than LONG_TEXTBLOCK, or ends a word of LONG_WORD or more
 * (autolink reads the last word before the change).
 */
function touchesLongText(tr: Transaction): boolean {
  let long = false;
  for (const { newRange } of getChangedRanges(combineTransactionSteps(tr.before, [tr]))) {
    const from = Math.max(0, newRange.from);
    const to = Math.min(tr.doc.content.size, newRange.to);
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (long) return false;
      if (!node.isTextblock) return true;
      if (node.content.size > LONG_TEXTBLOCK) long = true;
      else if (node.content.size >= LONG_WORD) {
        // The text just before and inside the change: enough to hold one word too long to search.
        const start = pos + 1;
        long = hasLongWord(tr.doc.textBetween(Math.max(start, from - LONG_WORD), Math.min(start + node.content.size, to), " ", " "));
      }
      return false;
    });
    if (long) return true;
  }
  return false;
}

/**
 * Keeps Tiptap's autolink out of very long paragraphs: it reads the whole last word before each space or Enter, and a
 * word of a megabyte (a pasted picture's text) takes it most of a minute. Typing there is kept as it is.
 */
export const LongTextGuard = Extension.create({
  name: "longTextGuard",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("longTextGuard"),
        // Runs before the transaction is applied, so autolink (appendTransaction) sees the mark.
        filterTransaction(tr) {
          if (tr.docChanged && !tr.getMeta("preventAutolink") && touchesLongText(tr)) tr.setMeta("preventAutolink", true);
          return true;
        },
      }),
    ];
  },
});
