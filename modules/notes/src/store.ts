// Reads and writes notes through the SDK. Each note is one document, shared by every Notes panel of this workspace.
// The open note is the item session's (`openItems`), the scratchpad and the order of the notes are document stores;
// the list keeps a light copy of each note for its preview, search and pins.

import { TavoraError, type DocumentSummary, type TavoraSDK } from "@tavora/sdk";
import { openDocument, openItems, type DocumentHandle, type DocumentStatus } from "@tavora/sdk/store";
import { ref, shallowRef, triggerRef } from "vue";
import { ACCEPT_ATTRIBUTE, isAcceptedType, prepareImage, type ImageQuality } from "./images";
import {
  cleanTitle,
  collectImageIds,
  ORDER_ID,
  parseAppearance,
  parseNote,
  parseOrder,
  SCRATCHPAD_ID,
  SCRATCHPAD_TITLE,
  titleFor,
  type Appearance,
  type NoteData,
  type NoteEntry,
  type RichText,
  type TextStyle,
} from "./notes";

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

export type NotesStore = Awaited<ReturnType<typeof createNotesStore>>;

/** The shown note changed: it was switched to (`pick`), edited here (`local`) or by another panel (`remote`). */
export interface NoteChange {
  id: string;
  source: "pick" | "local" | "remote" | "rollback";
  /** Another panel deleted the note; `data` is then the last copy. */
  deleted: boolean;
  data: NoteData;
}

const isConflict = (error: unknown): boolean => error instanceof TavoraError && error.code === "CONFLICT";

export async function createNotesStore(sdk: TavoraSDK, options: { debounceMs?: number } = {}) {
  const entries = ref(new Map<string, NoteEntry>());
  const appearance = ref<Appearance>(parseAppearance(null));
  /** How pictures are stored: shrunk (Optimized) or exactly as the file (Original). */
  const imageQuality = ref<ImageQuality>("optimized");
  /** The note this panel shows: a note's id, or the scratchpad's. */
  const selectedId = ref(SCRATCHPAD_ID);
  /** The shown note's document; its `data` and `update` are the document store's. Replaced when another note is shown. */
  const current = shallowRef<DocumentHandle<NoteData> | null>(null);
  /** Another panel deleted the shown note, which stays open until the user leaves it or brings it back. */
  const deleted = ref(false);
  const status = ref<DocumentStatus>("idle");

  // The editor owns the whole note, so its copy wins over a save another panel made in between.
  const noteOptions = {
    parse: parseNote,
    title: (data: NoteData) => titleFor("", data.text, data.title),
    merge: "mine" as const,
    ...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
  };

  /** The order the user put the notes in; notes not in it follow by age. */
  const orderDoc = await openDocument(sdk, ORDER_ID, { parse: (raw) => ({ ids: parseOrder(raw) }), title: () => "Order" });
  const order = ref<string[]>(orderDoc.data.ids);
  orderDoc.onChange((event) => (order.value = event.data.ids));

  /** The scratchpad is a note of its own that is always there, so it is not part of the item session's choice. */
  const scratchpad = await openDocument(sdk, SCRATCHPAD_ID, { ...noteOptions, title: () => SCRATCHPAD_TITLE });

  const session = await openItems<NoteData>(sdk, {
    ...noteOptions,
    // Notes made before the session have bare ids, so there is no prefix; the scratchpad and the order are filtered out.
    prefix: "",
    onAdd: "none",
    followNavigate: false,
    restore: (launch, state) => {
      const saved = launch.reason !== "add" && launch.content?.id ? launch.content.id : (state as { selected?: unknown } | null)?.selected;
      return typeof saved === "string" && saved !== SCRATCHPAD_ID && saved !== ORDER_ID ? saved : null;
    },
  });

  const listeners = new Set<(change: NoteChange) => void>();
  const announce = (change: NoteChange) => {
    for (const fn of [...listeners]) fn(change);
  };

  function remember(id: string, data: NoteData, summary: Pick<DocumentSummary, "updatedAt" | "revision">) {
    entries.value.set(id, {
      id,
      title: titleFor(id, data.text, data.title),
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
    if (id === ORDER_ID) return;
    const doc = await sdk.documents.get(id);
    if (doc) remember(id, parseNote(doc.data), doc);
    else forget(id);
  }

  const stamp = (handle: DocumentHandle<NoteData>) => ({ updatedAt: new Date().toISOString(), revision: handle.revision });

  scratchpad.onChange((event) => {
    if (!event.deleted) remember(SCRATCHPAD_ID, event.data, stamp(scratchpad));
    announce({ id: SCRATCHPAD_ID, source: event.source, deleted: false, data: event.data });
  });

  const showCurrent = () => {
    const open = session.currentId !== null ? session.current : null;
    selectedId.value = session.currentId ?? SCRATCHPAD_ID;
    current.value = open ?? scratchpad;
  };
  showCurrent();

  session.onChange((event) => {
    if (event.type !== "current") return;
    if (event.source === "pick") showCurrent();
    deleted.value = event.id !== null && session.deleted;
    const open = session.current;
    if (event.id === null || !open) return;
    if (!event.deleted) remember(event.id, open.data, stamp(open));
    announce({ id: event.id, source: event.source, deleted: event.deleted, data: open.data });
  });
  session.onStatus((next) => (status.value = next));

  const stopWatching = sdk.documents.onChange((change) => {
    if (change.id === ORDER_ID) return;
    if (change.deleted) return forget(change.id);
    // The shown notes follow through their own documents.
    if (change.id === SCRATCHPAD_ID || change.id === session.currentId) return;
    void refresh(change.id).catch(() => undefined);
  });

  let beforeSwitch: () => Promise<void> | void = () => undefined;
  const stopNavigating = sdk.panel.onNavigate(async (content) => {
    await beforeSwitch();
    if (!(await session.job(() => selectNow(content.id)))) throw new Error("another note was picked first");
  });

  /** Shows a note, or the scratchpad (no open item). Saves the note that was shown. */
  function selectNow(id: string): Promise<boolean> {
    if (id === ORDER_ID) throw new Error("not a note");
    return session.pick(id === SCRATCHPAD_ID ? null : id);
  }

  /** The note's open document: the scratchpad, or the one the session has open. */
  const handleFor = (id: string) => (id === SCRATCHPAD_ID ? scratchpad : session.currentId === id ? session.current : null);

  /** Changes a note that may not be the shown one: opened, changed, saved and closed. */
  async function editNote(id: string, change: (draft: NoteData) => void): Promise<void> {
    const open = handleFor(id);
    if (open) {
      open.update(change);
      await open.flush();
      return;
    }
    const other = await openDocument(sdk, id, noteOptions);
    try {
      if (other.revision === 0) return;
      other.update(change);
      await other.flush();
    } finally {
      await other.dispose();
    }
    await refresh(id);
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
    const summaries = (await sdk.documents.list()).filter((summary) => summary.id !== ORDER_ID);
    for (let start = 0; start < summaries.length; start += BATCH) {
      await Promise.all(summaries.slice(start, start + BATCH).map((summary) => refresh(summary.id)));
    }
  }

  return {
    entries,
    appearance,
    order,
    imageQuality,
    selectedId,
    current,
    deleted,
    status,
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
    setOrder: (ids: string[]) => {
      order.value = ids;
      orderDoc.update((data) => void (data.ids = ids));
      return orderDoc.flush();
    },
    loadAppearance,
    /** Changes the text look of the notes or of the scratchpad and stores it. */
    setStyle: async (kind: keyof Appearance, patch: Partial<TextStyle>) => {
      appearance.value = { ...appearance.value, [kind]: { ...appearance.value[kind], ...patch } };
      await sdk.storage.set("appearance", appearance.value);
    },
    /** The shown note changed, here or in another panel; returns a way to stop listening. */
    onChange(fn: (change: NoteChange) => void): () => void {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    /** Runs before another note is shown for `panels.open`, so typing the editor still holds is kept. */
    onBeforeSwitch(fn: () => Promise<void> | void) {
      beforeSwitch = fn;
    },
    /** Shows a note (or the scratchpad); rejects when it does not exist or the shown note could not be saved. */
    select: async (id: string): Promise<void> => void (await selectNow(id)),
    /** The scratchpad's document, for Save as note and Clear. */
    scratchpad,
    /** Saves the shown notes. */
    flush: () => Promise.all([scratchpad.flush(), session.flush()]).then(() => undefined),
    /** Puts a note deleted elsewhere back, as this panel last saw it. */
    restoreDeleted: async () => {
      await session.restoreDeleted();
      if (session.currentId) await refresh(session.currentId);
    },
    setPinned: (id: string, pinned: boolean) => editNote(id, (data) => void (data.pinned = pinned)),
    /** A title set by hand; empty goes back to the first line. */
    rename: (id: string, title: string) => editNote(id, (data) => void (data.title = cleanTitle(title))),
    /** A new note, empty or starting with the given text (Save as note); it is shown. */
    async create(initial?: { content: RichText; text: string }): Promise<string> {
      const data = parseNote(null);
      if (initial) {
        data.content = initial.content;
        data.images = collectImageIds(initial.content);
        data.text = initial.text;
      }
      return session.create(data);
    },
    /**
     * Deletes a note. Resolves with a way to put it back as it was (Undo). The scratchpad is only cleared, by the caller.
     * The shown note is left first, so the panel moves to the scratchpad, as it always did.
     */
    async remove(id: string): Promise<() => Promise<void>> {
      if (id === SCRATCHPAD_ID || id === ORDER_ID) throw new Error("not a note");
      if (session.currentId === id) await selectNow(SCRATCHPAD_ID);
      let undo: () => Promise<void>;
      try {
        undo = await session.remove(id);
      } catch (error) {
        if (!isConflict(error)) throw error;
        // Another panel saved the note since the list was read: delete the copy it has now.
        await session.refresh();
        undo = await session.remove(id);
      }
      forget(id);
      return async () => {
        await undo();
        await refresh(id);
      };
    },
    /** Saves what is left and stops listening. */
    async dispose() {
      stopWatching();
      stopNavigating();
      listeners.clear();
      await Promise.all([orderDoc.dispose(), scratchpad.dispose(), session.dispose()]);
    },
  };
}
