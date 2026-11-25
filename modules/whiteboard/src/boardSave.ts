// How a board is saved, without Excalidraw. The drawing is handed over as it changes; a moment after drawing stops it is
// put into the board's document (a `merge: "mine"` handle of the document store, so this panel's drawing wins over a
// save another panel made in between). Pictures go to the file store first, as the board only keeps their ids.

import type { JsonValue } from "@tavora/sdk";
import type { DocumentHandle } from "@tavora/sdk/store";
import type { SaveState } from "./boardState";
import { MAX_BOARD_BYTES, sceneSignature, shownBackground, type BoardData } from "./boards";
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

/** What was drawn could not be stored (too big, or the host refused it), so the board must stay open. */
export class BoardNotSaved extends Error {
  constructor() {
    super("the board could not be saved");
    this.name = "BoardNotSaved";
  }
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
  const first = signatureOf({ elements: document.data.elements as unknown as SceneElement[], background: shownBackground(document.data.background), grid: document.data.grid, files: {} });

  /** The newest drawing, kept outside the page's render so drawing never waits for it. */
  let latest: Scene | null = null;
  /** The drawing last stored, and the drawing last handed to a save (a save may still be running). */
  let stored = first;
  let queued = first;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> = Promise.resolve();
  let failures = 0;
  /** A background the user picked on purpose (even the one shown), saved as it is until it is stored. */
  let pickedBackground: string | null = null;
  /**
   * Why nothing is saved any more, or null while it saves: the board was deleted elsewhere, the page let go of it for a
   * delete (`resume` takes that back when the delete did not go through), or the saver was disposed.
   */
  let stopped: "deleted" | "discarded" | "disposed" | null = null;
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
  /**
   * The board's last real data: after a delete elsewhere the handle's `data` is an empty placeholder (no name, no
   * pictures, fields a newer version added gone), so bringing the board back builds on this instead.
   */
  let base: BoardData = document.data;
  const stopChanges = document.onChange((event) => {
    if (!event.deleted) {
      base = event.data;
      return;
    }
    stopped = "deleted";
    clearTimeout(timer);
    timer = undefined;
    set({ deleted: true });
  });

  function schedule(): void {
    set({ dirty: true });
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), delay);
  }

  function flush(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    const scene = latest;
    if (!scene || stopped) return saving;
    const signature = signatureOf(scene);
    if (signature === queued) return saving;
    queued = signature;
    const pick = pickedBackground;
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
          // Unchanged here: what was stored stays, also a background a newer version added that the board shows as the default.
          // A pick is saved as it is.
          background: pick === null && scene.background === shownBackground(document.data.background) ? document.data.background : scene.background,
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
          if (pickedBackground === pick) pickedBackground = null;
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
      if (stopped || signatureOf(scene) === queued) return;
      schedule();
    },
    /**
     * The user picked a background in Excalidraw's palette. It is saved as it is, also when it is the one the board shows for
     * a background a newer version stored (picking it changes nothing Excalidraw reports, so `change` can't see it).
     */
    pickBackground(background: string): void {
      if (stopped || !latest) return;
      latest = { ...latest, background };
      pickedBackground = background;
      queued = "";
      schedule();
    },
    /** Saves what is not stored yet; resolves once it is, or once saving failed (the state says so). */
    flush,
    /** Saves what is not stored yet and rejects when that failed, so a switch stays on this board instead of losing it. */
    async settled(): Promise<void> {
      await flush();
      // An earlier failure only counts while what is on the board is still not stored (Undo may have taken it back).
      if (!stopped && state.save === "error" && latest && signatureOf(latest) !== stored) throw new BoardNotSaved();
    },
    /**
     * What the board shows now, as a stored board, for bringing it back after another panel deleted it (nothing is saved
     * meanwhile): the board's last real data (name, when it was made, its pictures' stored files, fields a newer version
     * added) with the drawing on top. Pictures added since keep their elements; their pixels are stored with the next save.
     * Null before anything was drawn.
     */
    copy(): BoardData | null {
      if (!latest) return null;
      const elements = latest.elements.filter((element) => !element.isDeleted);
      // The stored files it had, plus those of pictures on the board that were stored since (or brought back by Undo).
      const files = { ...base.files };
      for (const id of pictureFileIds(elements)) {
        const known = pictures.stored.get(id);
        if (known) files[id] = known;
      }
      return {
        ...base,
        elements: JSON.parse(JSON.stringify(elements)) as JsonValue[],
        files,
        background: latest.background === shownBackground(base.background) ? base.background : latest.background,
        grid: latest.grid,
      };
    },
    /** Lets go without saving what is left (the board is being deleted). */
    discard(): void {
      if (stopped === null) stopped = "discarded";
      clearTimeout(timer);
      timer = undefined;
    },
    /** The delete after `discard` did not go through: the board stays open, so what was drawn on it is saved again. */
    resume(): void {
      if (stopped !== "discarded") return;
      stopped = null;
      if (latest && signatureOf(latest) !== queued) schedule();
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
      stopped = "disposed";
      stopErrors();
      stopChanges();
      stateListeners.clear();
      problemListeners.clear();
    },
  };
}
