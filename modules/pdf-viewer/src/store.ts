// Reads and writes the file list through the SDK. One `files` document per workspace, shared by every PDF Viewer
// panel; the stored files themselves are in the module's file store.

import { TavoraError, type TavoraSDK } from "@tavora/sdk";
import { openDocument } from "@tavora/sdk/store";
import { ref } from "vue";
import { addFile, cleanName, detectType, emptyFiles, FILES_ID, kindOf, parseFiles, parseView, removeFile, renameFile, setFileView, type FileEntry, type FileView, type FilesData } from "./files";

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

  /** Stores a picked or dropped file and adds it to the list. */
  async function add(file: File): Promise<FileEntry> {
    const type = detectType(file);
    if (!type) throw new FileProblem("type", "type", file.name);
    const usage = await sdk.blobs.usage();
    if (file.size > usage.maxFileBytes) throw new FileProblem("size", String(usage.maxFileBytes), file.name);
    if (usage.bytes + file.size > usage.maxBytes) throw new FileProblem("full", String(usage.maxBytes), file.name);
    let info;
    try {
      info = await sdk.blobs.put(file.type === type ? file : new Blob([file], { type }));
    } catch (error) {
      if (error instanceof TavoraError && error.code === "QUOTA_EXCEEDED") throw new FileProblem("full", error.message, file.name);
      throw new FileProblem("store", error instanceof Error ? error.message : String(error), file.name);
    }
    const entry: FileEntry = {
      id: info.id,
      name: cleanName(file.name) || info.id.slice(0, 8),
      type: info.type,
      kind: kindOf(info.type),
      addedAt: info.createdAt,
      view: parseView(null, kindOf(info.type)),
    };
    doc.update((data) => addFile(data, entry));
    await doc.flush();
    return entry;
  }

  return {
    files,
    find,
    add,
    url: (id: string) => sdk.blobs.url(id),
    usage: () => sdk.blobs.usage(),
    rename: (id: string, name: string) => {
      doc.update((data) => renameFile(data, id, name));
      return doc.flush();
    },
    /** Deletes the stored file and its entry. */
    async remove(id: string): Promise<void> {
      await sdk.blobs.delete(id);
      doc.update((data) => removeFile(data, id));
      await doc.flush();
    },
    /** Remembers where the reader was in a file (saved a moment later). */
    setView(id: string, view: Partial<FileView>) {
      doc.update((data) => setFileView(data, id, view));
    },
    flush: () => doc.flush(),
    dispose: () => doc.dispose(),
  };
}
