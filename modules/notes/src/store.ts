// Reads and writes notes through the SDK. Each note is one document, shared
// by every Notes panel of this workspace; the list keeps a light copy of each.

import { readDocument, serial, updateDocument, type Versioned } from "@tavora/official-ui";
import { TavoraError, type DocumentSummary, type TavoraSDK } from "@tavora/sdk";
import { ref, triggerRef } from "vue";
import { ACCEPT_ATTRIBUTE, isAcceptedType, prepareImage, type ImageQuality } from "./images";
import { cleanTitle, collectImageIds, ORDER_ID, parseAppearance, parseNote, parseOrder, titleFor, UNTITLED, type Appearance, type NoteData, type NoteEntry, type RichText, type TextStyle } from "./notes";

/** A picture that was not stored, and why: the kind of file, its size, or the host (with its message). */
export class ImageProblem extends Error {
  constructor(
    readonly kind: "type" | "size" | "store",
    message: string,
    readonly file = "",
  ) {
    super(message);
  }
}

/** A stored picture that no note uses is only removed when it is this old, so one that is being added is never taken. */
const UNUSED_AFTER_MS = 60 * 60 * 1000;

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
  const appearance = ref<Appearance>(parseAppearance(null));
  /** The order the user put the notes in; notes not in it follow by age. */
  const order = ref<string[]>([]);
  /** How pictures are stored: shrunk (Optimized) or exactly as the file (Original). */
  const imageQuality = ref<ImageQuality>("optimized");
  const queue = serial();

  function remember(id: string, data: NoteData, summary: Pick<DocumentSummary, "title" | "updatedAt" | "revision">) {
    entries.value.set(id, {
      id,
      title: summary.title,
      text: data.text,
      fixedTitle: data.title,
      images: data.images,
      pinned: data.pinned,
      createdAt: data.createdAt,
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
    if (id === ORDER_ID) {
      order.value = (await readDocument(sdk, ORDER_ID, parseOrder)).data;
      return;
    }
    const doc = await sdk.documents.get(id);
    if (doc) remember(id, parseNote(doc.data), doc);
    else forget(id);
  }

  /** The text look chosen for this workspace, kept in the module's own storage. */
  async function loadAppearance(): Promise<void> {
    appearance.value = parseAppearance(await sdk.storage.get("appearance"));
  }

  async function loadImageQuality(): Promise<void> {
    imageQuality.value = (await sdk.storage.get("imageQuality")) === "original" ? "original" : "optimized";
  }

  /** Stores a picture the user picked, pasted or dropped, at the chosen quality, and returns its id. */
  async function addImage(file: File): Promise<string> {
    if (!isAcceptedType(file.type)) throw new ImageProblem("type", "type", file.name);
    const usage = await sdk.blobs.usage();
    if (file.size > usage.maxFileBytes) throw new ImageProblem("size", String(usage.maxFileBytes), file.name);
    try {
      return (await sdk.blobs.put(await prepareImage(file, imageQuality.value))).id;
    } catch (error) {
      throw new ImageProblem("store", error instanceof TavoraError || error instanceof Error ? error.message : String(error), file.name);
    }
  }

  /** Deletes stored pictures that no note refers to any more (and are not new). Run once the notes are loaded. */
  async function removeUnusedImages(): Promise<void> {
    // Another panel may have saved or added a note since this one loaded; its pictures are not in the list below, so wait for the next start.
    const current = (await sdk.documents.list()).filter((summary) => summary.id !== ORDER_ID);
    if (current.some((summary) => entries.value.get(summary.id)?.revision !== summary.revision)) return;
    const used = new Set([...entries.value.values()].flatMap((entry) => entry.images));
    const now = Date.now();
    for (const blob of await sdk.blobs.list()) {
      if (!used.has(blob.id) && now - Date.parse(blob.createdAt) > UNUSED_AFTER_MS) await sdk.blobs.delete(blob.id);
    }
  }

  async function load(): Promise<void> {
    const all = await sdk.documents.list();
    const summaries = all.filter((summary) => summary.id !== ORDER_ID);
    if (summaries.length !== all.length) await refresh(ORDER_ID);
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
    appearance,
    order,
    imageQuality,
    load,
    loadImageQuality,
    addImage,
    removeUnusedImages,
    acceptAttribute: ACCEPT_ATTRIBUTE,
    blobUrl: (id: string) => sdk.blobs.url(id),
    imageUsage: () => sdk.blobs.usage(),
    setImageQuality: async (quality: ImageQuality) => {
      imageQuality.value = quality;
      await sdk.storage.set("imageQuality", quality);
    },
    /** Stores a new order of the notes; other panels follow. */
    setOrder: (ids: string[]) =>
      queue(async () => {
        order.value = ids;
        await updateDocument(sdk, ORDER_ID, { parse: (raw) => ({ ids: parseOrder(raw) }), change: (data) => void (data.ids = ids), title: () => "Order" });
      }),
    /** Puts a deleted note back as it was (Undo). */
    restore: (id: string, data: NoteData) =>
      queue(async () => {
        const saved = await sdk.documents.put({ id, title: titleFor(id, data.text, data.title), data, ifRevision: 0 });
        remember(id, data, saved);
      }),
    loadAppearance,
    /** Changes the text look of the notes or of the scratchpad and stores it. */
    setStyle: async (kind: keyof Appearance, patch: Partial<TextStyle>) => {
      appearance.value = { ...appearance.value, [kind]: { ...appearance.value[kind], ...patch } };
      await sdk.storage.set("appearance", appearance.value);
    },
    refresh,
    forget,
    open,
    /** The editor's text and title win over a save another panel made in between. */
    save: (id: string, patch: NotePatch) =>
      update(id, (data) => {
        if (patch.content !== undefined) {
          data.content = patch.content;
          data.images = collectImageIds(patch.content);
        }
        if (patch.text !== undefined) data.text = patch.text;
        if (patch.title !== undefined) data.title = cleanTitle(patch.title);
      }),
    saveContent: (id: string, content: RichText, text: string) =>
      update(id, (data) => {
        data.content = content;
        data.images = collectImageIds(content);
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
          data.images = collectImageIds(initial.content);
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
