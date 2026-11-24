// Puts a note into the one editor every note shares (another note was picked, another panel saved, a reload).
import type { Editor, JSONContent } from "@tiptap/core";
import { contentFromText, type NoteData } from "./notes";

/**
 * Shows a note's formatting; a stored note the editor cannot read shows its plain text instead of breaking the panel.
 * It is not a step Ctrl+Z takes back (addToHistory off): undoing it would put the note shown before into this one.
 */
export function showNote(instance: Editor, note: Pick<NoteData, "content" | "text">): void {
  const show = (content: JSONContent, strict: boolean) =>
    instance.chain().setMeta("addToHistory", false).setContent(content, { emitUpdate: false, errorOnInvalidContent: strict }).run();
  try {
    show(note.content as JSONContent, true);
  } catch {
    show(contentFromText(note.text) as JSONContent, false);
  }
}
