// Reads and writes the file list through the SDK. One `files` document per workspace, shared by every PDF Viewer
// panel; the stored files themselves are in the module's file store.

import { TavoraError, type ReadOnlyFile, type TavoraSDK } from "@tavora/sdk";
import { openDocument } from "@tavora/sdk/store";
import { ref } from "vue";
import { addFile, blobOf, cleanName, detectType, dropLink, emptyFiles, FILES_ID, kindOf, linkStatus, parseFiles, parseView, removeFile, renameFile, replaceCopy, setFileView, skipVersion, versionOf, type FileEntry, type FileLink, type FileView, type FilesData, type LinkStatus } from "./files";

/** A file that was not added, and why: its kind, its size, or the host (with its message). */
export class FileProblem extends Error {
  constructor(
    readonly kind: "type" | "size" | "full" | "store",
    message: string,
    readonly file = "",
  ) {
    super(message);
  }
}

export type FilesStore = Awaited<ReturnType<typeof createFilesStore>>;

export async function createFilesStore(sdk: TavoraSDK, options: { /** The document's name, in the reader's language. */ title: () => string; debounceMs?: number }) {
  const doc = await openDocument<FilesData>(sdk, FILES_ID, {
    parse: (raw) => (raw === null ? emptyFiles() : parseFiles(raw)),
    title: options.title,
    ...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
  });
  const files = ref<FileEntry[]>(doc.data.files);
  doc.onChange((event) => (files.value = event.data.files));

  const find = (id: string) => files.value.find((file) => file.id === id);

  /** Puts a file into the module's file store, after checking that it is a kind we show and that it fits. */
  async function store(file: Blob, name: string, type: string | null) {
    if (!type) throw new FileProblem("type", "type", name);
    const usage = await sdk.blobs.usage();
    if (file.size > usage.maxFileBytes) throw new FileProblem("size", String(usage.maxFileBytes), name);
    if (usage.bytes + file.size > usage.maxBytes) throw new FileProblem("full", String(usage.maxBytes), name);
    try {
      return await sdk.blobs.put(file.type === type ? file : new Blob([file], { type }));
    } catch (error) {
      if (error instanceof TavoraError && error.code === "QUOTA_EXCEEDED") throw new FileProblem("full", error.message, name);
      throw new FileProblem("store", error instanceof Error ? error.message : String(error), name);
    }
  }

  async function list(name: string, info: { id: string; type: string; createdAt: string }, link?: FileLink): Promise<FileEntry> {
    const entry: FileEntry = {
      id: info.id,
      ...(link ? { link } : {}),
      name: cleanName(name) || info.id.slice(0, 8),
      type: info.type,
      kind: kindOf(info.type),
      addedAt: info.createdAt,
      view: parseView(null, kindOf(info.type)),
    };
    doc.update((data) => addFile(data, entry));
    await doc.flush();
    return entry;
  }

  /** Stores a dropped file (or one picked without Tavora's dialog) and adds it to the list. */
  async function add(file: File): Promise<FileEntry> {
    return list(file.name, await store(file, file.name, detectType(file)));
  }

  /** Reads an original as it is now: its bytes, and the version they came from. */
  async function readOriginal(ref: string, name: string): Promise<{ bytes: Blob; link: FileLink }> {
    const state = await sdk.files.check(ref);
    if (!state.found) throw new FileProblem("store", state.reason, name);
    const bytes = await sdk.files.read(ref);
    return { bytes: new Blob([new Uint8Array(bytes)]), link: { ref, size: state.size, modifiedAt: state.modifiedAt } };
  }

  /** Stores a copy of a file picked in Tavora's open dialog, linked to the original, and adds it to the list. */
  async function addLinked(picked: ReadOnlyFile): Promise<FileEntry> {
    try {
      const { bytes, link } = await readOriginal(picked.id, picked.name);
      return await list(picked.name, await store(bytes, picked.name, detectType({ name: picked.name, type: "" })), link);
    } catch (error) {
      await sdk.files.forget(picked.id).catch(() => undefined);
      if (error instanceof FileProblem) throw error;
      throw new FileProblem("store", error instanceof Error ? error.message : String(error), picked.name);
    }
  }

  /** How the original of a file is doing; null when it has none. */
  async function check(id: string): Promise<LinkStatus | null> {
    const link = find(id)?.link;
    return link ? linkStatus(link, await sdk.files.check(link.ref)) : null;
  }

  /** Copies the original again, in place of the copy the file shows now. The tab, name and place stay. */
  async function reload(id: string): Promise<void> {
    const file = find(id);
    if (!file?.link) return;
    const before = blobOf(file);
    const { bytes, link } = await readOriginal(file.link.ref, file.name);
    const info = await store(bytes, file.name, detectType({ name: file.name, type: "" }) ?? file.type);
    doc.update((data) => replaceCopy(data, id, info.id, info.type, link));
    await doc.flush();
    if (info.id !== before) await sdk.blobs.delete(before).catch(() => undefined);
  }

  /** Not now: the original's current version asks no more. */
  async function skip(id: string): Promise<void> {
    const link = find(id)?.link;
    if (!link) return;
    const state = await sdk.files.check(link.ref);
    if (!state.found) return;
    doc.update((data) => skipVersion(data, id, versionOf(state)));
    await doc.flush();
  }

  /** Keep my copy: the file forgets its original, and so does Tavora. */
  async function unlink(id: string): Promise<void> {
    const link = find(id)?.link;
    if (!link) return;
    doc.update((data) => dropLink(data, id));
    await doc.flush();
    await sdk.files.forget(link.ref).catch(() => undefined);
  }

  return {
    files,
    find,
    add,
    addLinked,
    check,
    reload,
    skip,
    unlink,
    /** Opens the folder of a file's original (from a click). */
    showInFolder: async (id: string) => {
      const link = find(id)?.link;
      if (link) await sdk.files.showInFolder(link.ref);
    },
    url: (id: string) => {
      const file = find(id);
      return sdk.blobs.url(file ? blobOf(file) : id);
    },
    usage: () => sdk.blobs.usage(),
    rename: (id: string, name: string) => {
      doc.update((data) => renameFile(data, id, name));
      return doc.flush();
    },
    /** Deletes the stored file and its entry, and drops the link to its original. */
    async remove(id: string): Promise<void> {
      const file = find(id);
      await sdk.blobs.delete(file ? blobOf(file) : id);
      doc.update((data) => removeFile(data, id));
      await doc.flush();
      if (file?.link) await sdk.files.forget(file.link.ref).catch(() => undefined);
    },
    /** Remembers where the reader was in a file (saved a moment later). */
    setView(id: string, view: Partial<FileView>) {
      doc.update((data) => setFileView(data, id, view));
    },
    flush: () => doc.flush(),
    dispose: () => doc.dispose(),
  };
}
