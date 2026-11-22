// The editor's text features: formatting, lists, checklists and links. NoteEditor.vue adds pictures and the
// placeholder; the tests build an editor from these alone.

import { TaskItem, TaskList } from "@tiptap/extension-list";
import StarterKit from "@tiptap/starter-kit";
import { LongTextGuard } from "./paste";

export function textExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // Links are kept and shown; clicking one shows a bar, and Ctrl+click opens it in the Browser.
      link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["mailto"] },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    LongTextGuard,
  ];
}
