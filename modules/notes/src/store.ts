// Reads and writes notes through the SDK. Each note is one document, shared
// by every Notes panel of this game; the list keeps a light copy of each.

import { readDocument, serial, updateDocument, type Versioned } from "@tavora/official-ui";
import type { DocumentSummary, TavoraSDK } from "@tavora/sdk";
import { ref, triggerRef } from "vue";
import { cleanTitle, parseNote, titleFor, UNTITLED, type NoteData, type NoteEntry, type RichText } from "./notes";

/** Requests the SDK may have open at once is 64; stay well below it. */
const BATCH = 16;

export type NotesStore = ReturnType<typeof createNotesStore>;

/** What a save changes; anything left out stays as stored. */
export interface NotePatch {
  content?: RichText;
  text?: string;
  title?: string;
}

export function createNotesStore(sdk: TavoraSDK) {
  const entries = ref(new Map<string, NoteEntry>());
  const queue = serial();

  function remember(id: string, data: NoteData, summary: Pick<DocumentSummary, "title" | "updatedAt" | "revision">) {
    entries.value.set(id, {
      id,
      title: summary.title,
      text: data.text,
      fixedTitle: data.title,
      pinned: data.pinned,
      updatedAt: summary.updatedAt,
      revision: summary.revision,
    });
    triggerRef(entries);
  }

  function forget(id: string) {
    if (entries.value.delete(id)) triggerRef(entries);
  }

  /** Reads one note again, after another panel changed it. */
  async function refresh(id: string): Promise<void> {
    const doc = await sdk.documents.get(id);
    if (doc) remember(id, parseNote(doc.data), doc);
    else forget(id);
  }

  async function load(): Promise<void> {
    const summaries = await sdk.documents.list();
    for (let start = 0; start < summaries.length; start += BATCH) {
      await Promise.all(summaries.slice(start, start + BATCH).map((summary) => refresh(summary.id)));
    }
  }

  async function open(id: string): Promise<Versioned<NoteData>> {
    return readDocument(sdk, id, parseNote);
  }

  /** Saves after a change; returns once this and every earlier save is stored. */
  function update(id: string, change: (data: NoteData) => void): Promise<void> {
    return queue(async () => {
      const saved = await updateDocument(sdk, id, { parse: parseNote, change, title: (data) => titleFor(id, data.text, data.title) });
      remember(id, saved.data, { ...saved, title: titleFor(id, saved.data.text, saved.data.title) });
    });
  }

  return {
    entries,
    load,
    refresh,
    forget,
    open,
    /** The editor's text and title win over a save another panel made in between. */
    save: (id: string, patch: NotePatch) =>
      update(id, (data) => {
        if (patch.content !== undefined) data.content = patch.content;
        if (patch.text !== undefined) data.text = patch.text;
        if (patch.title !== undefined) data.title = cleanTitle(patch.title);
      }),
    saveContent: (id: string, content: RichText, text: string) =>
      update(id, (data) => {
        data.content = content;
        data.text = text;
      }),
    setPinned: (id: string, pinned: boolean) => update(id, (data) => void (data.pinned = pinned)),
    /** A new note, empty or starting with the given text (Save as note). */
    async create(initial?: { content: RichText; text: string }): Promise<string> {
      const id = crypto.randomUUID();
      await queue(async () => {
        const data = parseNote(null);
        if (initial) {
          data.content = initial.content;
          data.text = initial.text;
        }
        const saved = await sdk.documents.put({ id, title: initial ? titleFor(id, data.text) : UNTITLED, data, ifRevision: 0 });
        remember(id, data, saved);
      });
      return id;
    },
    remove: (id: string) =>
      queue(async () => {
        await sdk.documents.delete(id);
        forget(id);
      }),
  };
}
