// @vitest-environment jsdom
// The editor is shared by every note: showing another one must not become a step Ctrl+Z can take back, or the old
// note's text would come back in the new one (and be saved into it).
import { Editor } from "@tiptap/core";
import { afterEach, expect, it } from "vitest";
import { contentFromText } from "./notes";
import { showNote } from "./showNote";
import { textExtensions } from "./textExtensions";

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

const note = (text: string) => ({ content: contentFromText(text), text });

it("Ctrl+Z after showing another note keeps that note's text", () => {
  let updates = 0;
  editor = new Editor({ extensions: textExtensions(), onUpdate: () => updates++ });
  showNote(editor, note("Note A"));
  editor.commands.insertContent(" typed");
  updates = 0;
  showNote(editor, note("Note B"));
  editor.commands.undo();
  expect(editor.getText()).toBe("Note B");
  expect(updates).toBe(0);
});

it("still undoes what was typed into the note shown", () => {
  editor = new Editor({ extensions: textExtensions() });
  showNote(editor, note("Note B"));
  editor.commands.focus("end");
  editor.commands.insertContent("!");
  editor.commands.undo();
  expect(editor.getText()).toBe("Note B");
});
