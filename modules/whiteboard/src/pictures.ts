// Pictures on a board. Excalidraw keeps a picture's pixels inside the scene, as a data address. A board is a
// document of at most 4 MB, so the pixels go to the file store instead and the board only remembers which
// stored file belongs to which picture. Nothing here knows about React.

import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import type { BlobInfo, TavoraSDK } from "@tavora/sdk";
import { BLOB_TYPES } from "@tavora/sdk";
import type { StoredFile } from "./boards";

type Files = Record<string, BinaryFileData>;

/** What the file store accepts. Other kinds (SVG, BMP, …) can be drawn on the board but not kept. */
export function isStorable(mimeType: string): boolean {
  return (BLOB_TYPES as readonly string[]).includes(mimeType);
}

/** The picture behind a data address, or null when the address is not a base64 one. */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]*)$/.exec(dataUrl);
  if (!match) return null;
  const binary = atob(match[2]!.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1]! });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("could not read the picture"));
    reader.readAsDataURL(blob);
  });
}

/** The ids of the files that the pictures on the board (not deleted ones) show. */
export function pictureFileIds(elements: readonly { type: string; isDeleted?: boolean; fileId?: string | null }[]): string[] {
  const ids = new Set<string>();
  for (const element of elements) if (element.type === "image" && !element.isDeleted && element.fileId) ids.add(element.fileId);
  return [...ids];
}

export interface SyncResult {
  /** The stored file of every picture on the board that has one, for the board's data. */
  files: Record<string, StoredFile>;
  /** Pictures that could not be kept, worded for the user. */
  problems: { kind: "unsupported" | "failed"; message: string }[];
}

export function createPictures(sdk: TavoraSDK, initial: Record<string, StoredFile>) {
  /** Picture file id → its stored file. Grows as pictures are added, and keeps files whose picture was deleted, so Undo works. */
  const stored = new Map<string, StoredFile>(Object.entries(initial));
  const warned = new Set<string>();

  return {
    stored,

    /** Stores the pictures that are on the board but not stored yet. */
    async sync(elements: readonly { type: string; isDeleted?: boolean; fileId?: string | null }[], files: Files): Promise<SyncResult> {
      const problems: SyncResult["problems"] = [];
      const result: Record<string, StoredFile> = {};
      for (const id of pictureFileIds(elements)) {
        const known = stored.get(id);
        if (known) {
          result[id] = known;
          continue;
        }
        const file = files[id];
        if (!file) continue;
        if (!isStorable(file.mimeType)) {
          if (!warned.has(id)) problems.push({ kind: "unsupported", message: file.mimeType });
          warned.add(id);
          continue;
        }
        const blob = dataUrlToBlob(file.dataURL);
        if (!blob) continue;
        try {
          const info: BlobInfo = await sdk.blobs.put(blob);
          const entry = { blobId: info.id, mimeType: info.type, created: file.created };
          stored.set(id, entry);
          result[id] = entry;
        } catch (error) {
          problems.push({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
        }
      }
      return { files: result, problems };
    },

    /** The pictures of a stored board, as Excalidraw wants them, read back from the file store. Those that cannot be read are left out. */
    async load(needed: readonly string[]): Promise<BinaryFileData[]> {
      const loaded: BinaryFileData[] = [];
      await Promise.all(
        needed.map(async (id) => {
          const entry = stored.get(id);
          if (!entry) return;
          try {
            const response = await fetch(sdk.blobs.url(entry.blobId));
            if (!response.ok) return;
            loaded.push({ id: id as BinaryFileData["id"], mimeType: entry.mimeType as BinaryFileData["mimeType"], dataURL: (await blobToDataUrl(await response.blob())) as BinaryFileData["dataURL"], created: entry.created });
          } catch {
            // A picture that cannot be read stays missing; the rest of the board is shown.
          }
        }),
      );
      return loaded;
    },
  };
}

/** A stored file that no board uses and that is old enough to be sure no panel is just adding it. */
export const UNUSED_AFTER_MS = 60 * 60 * 1000;

export function unusedFiles(all: readonly BlobInfo[], used: ReadonlySet<string>, now = Date.now()): BlobInfo[] {
  return all.filter((blob) => !used.has(blob.id) && now - Date.parse(blob.createdAt) > UNUSED_AFTER_MS);
}
