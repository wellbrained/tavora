// How a board is saved, without Excalidraw. The drawing is handed over as it changes; a moment after drawing stops it is
// put into the board's document (a `merge: "mine"` handle of the document store, so this panel's drawing wins over a
// save another panel made in between). Pictures go to the file store first, as the board only keeps their ids.

import type { JsonValue } from "@tavora/sdk";
import type { DocumentHandle } from "@tavora/sdk/store";
import type { SaveState } from "./boardState";
import { MAX_BOARD_BYTES, sceneSignature, type BoardData } from "./boards";
import { pictureFileIds, type createPictures } from "./pictures";

/** How long drawing must pause before the board is saved. */
export const SAVE_DELAY_MS = 600;

type Pictures = Pick<ReturnType<typeof createPictures>, "sync" | "stored">;

export interface SceneElement {
  type: string;
  versionNonce: number;
  isDeleted?: boolean;
  fileId?: string | null;
}

/** What Excalidraw reports about the board. */
export interface Scene {
  elements: readonly SceneElement[];
  background: string;
  grid: boolean;
  /** The pictures' pixels Excalidraw holds, by file id. */
  files: Parameters<Pictures["sync"]>[1];
}

export interface SaverState {
  save: SaveState;
  dirty: boolean;
  bytes: number;
  deleted: boolean;
}

export interface Problem {
  kind: "unsupported" | "failed";
  message: string;
}

export interface BoardSaverOptions {
  document: Pick<DocumentHandle<BoardData>, "data" | "update" | "flush" | "onChange" | "onError">;
  pictures: Pictures;
  delayMs?: number;
}

export function createBoardSaver(options: BoardSaverOptions) {
  const { document, pictures } = options;
  const delay = options.delayMs ?? SAVE_DELAY_MS;
  /**
   * What identifies a drawing: its elements and background, and which of its pictures have their pixels. Excalidraw adds
   * a picture's element first and its pixels a moment later, so the second step must count as a change to save.
   */
  const signatureOf = (scene: Scene) =>
    `${sceneSignature(scene.elements, scene.background, scene.grid)}|${pictureFileIds(scene.elements)
      .filter((id) => scene.files[id] || pictures.stored.has(id))
      .join(",")}`;
  const first = signatureOf({ elements: document.data.elements as unknown as SceneElement[], background: document.data.background, grid: document.data.grid, files: {} });

  /** The newest drawing, kept outside the page's render so drawing never waits for it. */
  let latest: Scene | null = null;
  /** The drawing last stored, and the drawing last handed to a save (a save may still be running). */
  let stored = first;
  let queued = first;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> = Promise.resolve();
  let failures = 0;
  /** Nothing is saved any more: the board was deleted elsewhere, or the page let go of it. */
  let paused = false;
  let state: SaverState = { save: "idle", dirty: false, bytes: JSON.stringify(document.data).length, deleted: false };

  const stateListeners = new Set<(state: SaverState) => void>();
  const problemListeners = new Set<(problem: Problem) => void>();
  const set = (patch: Partial<SaverState>) => {
    const next = { ...state, ...patch };
    if ((Object.keys(next) as (keyof SaverState)[]).every((key) => next[key] === state[key])) return;
    state = next;
    for (const fn of [...stateListeners]) fn(state);
  };

  // A failed save is told to the handle's `onError`, not to `flush`, so they are counted to tell a save that worked.
  const stopErrors = document.onError((_, kind) => {
    if (kind === "save") failures++;
  });
  const stopChanges = document.onChange((event) => {
    if (!event.deleted) return;
    paused = true;
    clearTimeout(timer);
    timer = undefined;
    set({ deleted: true });
  });

  function flush(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    const scene = latest;
    if (!scene || paused) return saving;
    const signature = signatureOf(scene);
    if (signature === queued) return saving;
    queued = signature;
    set({ save: "saving" });
    saving = saving
      .then(async () => {
        // Pictures first: the file store keeps their pixels, the board only the stored file's id.
        const synced = await pictures.sync(scene.elements, scene.files);
        for (const problem of synced.problems) for (const fn of [...problemListeners]) fn(problem);
        const next: BoardData = {
          ...document.data,
          // Through JSON so the stored copy is plain data (Excalidraw leaves some fields undefined).
          elements: JSON.parse(JSON.stringify(scene.elements.filter((element) => !element.isDeleted))) as JsonValue[],
          files: synced.files,
          background: scene.background,
          grid: scene.grid,
        };
        const bytes = JSON.stringify(next).length;
        set({ bytes });
        if (bytes > MAX_BOARD_BYTES) throw new Error("the board is too big to save");
        const before = failures;
        document.update(() => next);
        await document.flush();
        if (failures !== before) throw new Error("the board could not be saved");
      })
      .then(
        () => {
          stored = signature;
          // Saved, unless more was drawn meanwhile: that has its own save coming.
          if (queued === signature && !timer) set({ dirty: false, save: "saved" });
        },
        (reason: unknown) => {
          console.error("[whiteboard] could not save", reason);
          queued = stored;
          set({ save: "error" });
        },
      );
    return saving;
  }

  return {
    get state() {
      return state;
    },
    /** The drawing changed. */
    change(scene: Scene): void {
      latest = scene;
      if (paused || signatureOf(scene) === queued) return;
      set({ dirty: true });
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), delay);
    },
    /** Saves what is not stored yet; resolves once it is. */
    flush,
    /** Lets go without saving what is left (the board is being deleted). */
    discard(): void {
      paused = true;
      clearTimeout(timer);
      timer = undefined;
    },
    onState(fn: (state: SaverState) => void): () => void {
      stateListeners.add(fn);
      return () => void stateListeners.delete(fn);
    },
    /** A picture that could not be kept. */
    onProblem(fn: (problem: Problem) => void): () => void {
      problemListeners.add(fn);
      return () => void problemListeners.delete(fn);
    },
    /** Saves what is left and stops listening. */
    async dispose(): Promise<void> {
      await flush();
      paused = true;
      stopErrors();
      stopChanges();
      stateListeners.clear();
      problemListeners.clear();
    },
  };
}

export type BoardSaver = ReturnType<typeof createBoardSaver>;
