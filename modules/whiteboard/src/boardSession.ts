// One board open in Excalidraw, without any framework: it follows what Excalidraw reports, saves a moment after drawing
// stops, when the panel is hidden or closed, and when another board is opened (the page makes a new session for every
// board, so each starts with fresh undo history). Pictures (pasted, dropped or inserted) are kept in the file store and
// come back when the board is opened.

import { CaptureUpdateAction, exportToBlob } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawImageElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { JsonValue, TavoraSDK } from "@tavora/sdk";
import { MAX_BOARD_BYTES, sceneSignature, type BoardData } from "./boards";
import { COPY_PADDING, copyScale, elementsToCopy } from "./copy";
import { isCanvasAt } from "./excalidrawDom";
import { t } from "./i18n";
import { lockSpots, spotsKey, type LockSpot } from "./locks";
import { createPictures, pictureFileIds } from "./pictures";

/** How long drawing must pause before the board is saved. */
const SAVE_DELAY_MS = 600;
/** How long a lock that is covered waits before it is looked at again. */
const SPOT_RETRY_MS = 400;

export interface View {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export type SaveState = "idle" | "saving" | "saved" | "error";

/** What the page can ask of the board it shows. */
export interface Controls {
  setPicturesLocked(locked: boolean): void;
  /** Locks or frees one picture. */
  setPictureLocked(id: string, locked: boolean): void;
  /** Puts the selection, or the whole board when nothing is selected, on the clipboard as a PNG. Call it from a click or key press. */
  copyAsPicture(): Promise<"selection" | "board">;
  /** Saves the same picture through Tavora's save dialog, named after `name`; null when the player closed it. Call it from a click or key press. */
  saveAsPicture(name: string): Promise<{ what: "selection" | "board"; fileName: string } | null>;
  /** Takes everything off the board, as one step that Undo brings back; returns how to put it all back. */
  clear(): () => void;
}

/** The pictures on the board: how many, and whether they are all locked. */
export interface Pictures {
  count: number;
  allLocked: boolean;
}

export interface SessionOptions {
  sdk: TavoraSDK;
  data: BoardData;
  /** Whether the panel is dark, for the pictures the board makes. */
  isDark(): boolean;
  /** Stores the board. Resolves once it is stored, rejects when it could not be. */
  save(data: BoardData): Promise<void>;
  onState(state: SaveState): void;
  /** The size of the board as it would be stored, for the warning. */
  onSize(bytes: number): void;
  /** Whether there are changes that are not stored yet, so a change made in another panel is not taken over them. */
  onDirty(dirty: boolean): void;
  onPictures(pictures: Pictures): void;
  /** Whether the board has anything on it (Copy as picture needs something). */
  onEmpty(empty: boolean): void;
  /** Shift+Alt+C, Excalidraw's own shortcut for copying as PNG, which asks the page to copy. */
  onCopyShortcut(): void;
  /** How many of the board's stored pictures have been read back (for the page and its tests). */
  onPicturesLoaded(count: number): void;
  onNotice(message: string): void;
  onControls(controls: Controls | null): void;
  /** Where the picture locks go. */
  onSpots(spots: LockSpot[]): void;
  onView(view: View): void;
}

export interface BoardSession {
  /** Excalidraw's onChange. */
  change(elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles): void;
  /** Excalidraw's excalidrawAPI. */
  ready(instance: ExcalidrawImperativeAPI): void;
  scroll(scrollX: number, scrollY: number, zoom: { value: number }): void;
  /** Looks again at which picture locks Excalidraw's menus cover (after the palette moved, say). */
  recheckLocks(): void;
  /** Saves what is not stored yet. */
  flush(): Promise<void>;
  /** Saves what is left and lets go of the page's listeners. */
  dispose(): void;
}

const nonce = () => Math.floor(Math.random() * 2 ** 31);

export function createBoardSession(options: SessionOptions): BoardSession {
  const { sdk, data } = options;
  const pictures = createPictures(sdk, data.files);
  /** The newest drawing, kept outside the page's render so drawing never waits for it. */
  let latest: { elements: readonly OrderedExcalidrawElement[]; background: string; files: BinaryFiles } | null = null;
  /**
   * What identifies a drawing: its elements and background, and which of its pictures have their pixels. Excalidraw adds
   * a picture's element first and its pixels a moment later, so the second step must count as a change to save.
   */
  const signatureOf = (elements: readonly OrderedExcalidrawElement[], background: string, files: BinaryFiles) =>
    `${sceneSignature(elements, background)}|${pictureFileIds(elements).filter((id) => files[id] || pictures.stored.has(id)).join(",")}`;
  const first = signatureOf(data.elements as unknown as OrderedExcalidrawElement[], data.background, {});
  /** The drawing last stored, and the drawing last handed to a save (a save may still be running). */
  let stored = first;
  let queued = first;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> = Promise.resolve();
  let api: ExcalidrawImperativeAPI | null = null;
  /** Pictures already on the board when it opened or seen once since; only a new one is locked (once it is placed). */
  const seen = new Set<string>((data.elements as unknown as ExcalidrawElement[]).filter((element) => element.type === "image").map((element) => element.id));
  /** New pictures that are still being placed: they are locked once they are no longer selected. */
  const placing = new Set<string>();
  let summary = "";
  let empty: boolean | null = null;
  /** What the last look at the locks was made of, so the check below only runs when something that could change it did. */
  let spotsLayout = "";
  let rawSpots: LockSpot[] = [];
  let spotsSeen = "";
  let spotsFrame = 0;
  let spotsRetry: ReturnType<typeof setTimeout> | undefined;
  let boardOrigin = { left: 0, top: 0 };

  function flush(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    const scene = latest;
    if (!scene) return saving;
    const signature = signatureOf(scene.elements, scene.background, scene.files);
    if (signature === queued) return saving;
    queued = signature;
    options.onState("saving");
    saving = saving
      .then(async () => {
        // Pictures first: the file store keeps their pixels, the board only the stored file's id.
        const synced = await pictures.sync(scene.elements, scene.files);
        for (const problem of synced.problems) {
          options.onNotice(problem.kind === "unsupported" ? t("image.unsupported", { type: problem.message }) : t("image.failed", { error: problem.message }));
        }
        const next: BoardData = {
          ...data,
          // Through JSON so the stored copy is plain data (Excalidraw leaves some fields undefined).
          elements: JSON.parse(JSON.stringify(scene.elements.filter((element) => !element.isDeleted))) as JsonValue[],
          files: synced.files,
          background: scene.background,
        };
        const bytes = JSON.stringify(next).length;
        options.onSize(bytes);
        if (bytes > MAX_BOARD_BYTES) throw new Error("the board is too big to save");
        await options.save(next);
      })
      .then(
        () => {
          stored = signature;
          // Saved, unless more was drawn meanwhile: that has its own save coming.
          if (queued === signature && !timer) {
            options.onDirty(false);
            options.onState("saved");
          }
        },
        (reason: unknown) => {
          console.error("[whiteboard] could not save", reason);
          queued = stored;
          options.onState("error");
        },
      );
    return saving;
  }

  /** Looks at which locks are really on the drawing and not under Excalidraw's menus (the palette, the toolbar, …). */
  function showSpots(retry = false) {
    const visible = rawSpots.filter((spot) => isCanvasAt(boardOrigin.left + spot.x, boardOrigin.top + spot.y, ".picture-locks"));
    // Something may cover a lock only for a moment (Excalidraw redrawing its menus); a lock that is covered is looked
    // at again after the next change and a little later, so it is not missed.
    const covered = visible.length < rawSpots.length;
    if (covered) spotsLayout = "";
    if (covered && retry) {
      clearTimeout(spotsRetry);
      spotsRetry = setTimeout(() => showSpots(), SPOT_RETRY_MS);
    }
    const key = spotsKey(visible);
    if (key === spotsSeen) return;
    spotsSeen = key;
    options.onSpots(visible);
  }

  function checkSpots(appState: AppState, live: readonly OrderedExcalidrawElement[]) {
    rawSpots = lockSpots(live, { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom.value, width: appState.width, height: appState.height });
    boardOrigin = { left: appState.offsetLeft, top: appState.offsetTop };
    // What covers a lock is Excalidraw's menus, which come and go with the tool, the selection and the panel's size.
    // Only when one of those or a lock itself changed is the page asked what is where, not on every stroke.
    const layout = `${spotsKey(rawSpots)}#${appState.activeTool.type}#${Object.keys(appState.selectedElementIds).length}#${appState.openMenu}#${appState.openPopup}#${appState.width}x${appState.height}`;
    if (layout === spotsLayout) return;
    spotsLayout = layout;
    showSpots(true);
    // The menus have drawn themselves by the next frame; look once more then.
    cancelAnimationFrame(spotsFrame);
    spotsFrame = requestAnimationFrame(() => showSpots());
  }

  function change(elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) {
    latest = { elements, background: appState.viewBackgroundColor, files };

    // A picture that was just added stays free while it is selected, so it can be dragged into place first. Once it is
    // let go of (something else is selected, or nothing), it is locked, so scribbling on top of it does not drag it
    // around. Only once Excalidraw has given it its file: until then it is still changing the element.
    const live = elements.filter((element) => element.type === "image" && !element.isDeleted);
    for (const element of live) if (!seen.has(element.id)) placing.add(element.id);
    const placed = live.filter((element) => placing.has(element.id) && (element as ExcalidrawImageElement).fileId !== null && !appState.selectedElementIds[element.id]);
    if (placed.length > 0) {
      for (const element of placed) placing.delete(element.id);
      const ids = new Set(placed.map((element) => element.id));
      // After this change has been handled, not inside it.
      setTimeout(() => {
        const scene = api?.getSceneElements();
        if (!scene) return;
        api?.updateScene({
          elements: scene.map((element) => (ids.has(element.id) && !element.locked ? { ...element, locked: true, version: element.version + 1, versionNonce: nonce(), updated: Date.now() } : element)),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }, 0);
    }
    for (const element of live) seen.add(element.id);
    checkSpots(appState, live);
    const description = `${live.length}:${live.every((element) => element.locked)}`;
    if (description !== summary) {
      summary = description;
      options.onPictures({ count: live.length, allLocked: live.length > 0 && live.every((element) => element.locked) });
    }
    const nothing = !elements.some((element) => !element.isDeleted);
    if (nothing !== empty) {
      empty = nothing;
      options.onEmpty(nothing);
    }

    if (signatureOf(elements, appState.viewBackgroundColor, files) === queued) return;
    options.onDirty(true);
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }

  /** The selection, or the whole board when nothing is selected, as a PNG that looks as the board does in the panel. */
  async function pictureOf(instance: ExcalidrawImperativeAPI): Promise<{ png: Blob; what: "selection" | "board" }> {
    const appState = instance.getAppState();
    const elements = elementsToCopy(instance.getSceneElements(), appState.selectedElementIds);
    if (elements.length === 0) throw new Error("the board is empty");
    // As the board looks in the panel: its background, and dark when the panel is dark.
    const png = await exportToBlob({
      elements,
      files: instance.getFiles(),
      appState: { exportBackground: true, viewBackgroundColor: appState.viewBackgroundColor, exportWithDarkMode: options.isDark() },
      mimeType: "image/png",
      exportPadding: COPY_PADDING,
      getDimensions: (width: number, height: number) => {
        const scale = copyScale(width, height);
        return { width: Math.round(width * scale), height: Math.round(height * scale), scale };
      },
    });
    return { png, what: elements.length < instance.getSceneElements().length ? "selection" : "board" };
  }

  function setLocked(instance: ExcalidrawImperativeAPI, locked: boolean, only?: string) {
    instance.updateScene({
      elements: instance
        .getSceneElements()
        .map((element) => ((only ? element.id === only : element.type === "image") ? { ...element, locked, version: element.version + 1, versionNonce: nonce(), updated: Date.now() } : element)),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }

  // Reads the board's stored pictures back once Excalidraw is ready.
  function ready(instance: ExcalidrawImperativeAPI) {
    api = instance;
    options.onControls({
      setPicturesLocked: (locked) => setLocked(instance, locked),
      setPictureLocked: (id, locked) => {
        placing.delete(id);
        setLocked(instance, locked, id);
      },
      copyAsPicture: async () => {
        const picture = await pictureOf(instance);
        await sdk.clipboard.writeImage(picture.png);
        return picture.what;
      },
      saveAsPicture: async (name) => {
        const picture = await pictureOf(instance);
        const saved = await sdk.pictures.save(picture.png, name);
        return saved && { what: picture.what, fileName: saved.fileName };
      },
      clear: () => {
        const before = instance.getSceneElements();
        const bump = <T extends ExcalidrawElement>(element: T, isDeleted: boolean): T => ({ ...element, isDeleted, version: element.version + 2, versionNonce: nonce(), updated: Date.now() });
        instance.updateScene({ elements: before.map((element) => bump(element, true)), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        return () => {
          const ids = new Set(before.map((element) => element.id));
          const now = instance.getSceneElementsIncludingDeleted();
          instance.updateScene({ elements: now.map((element) => (ids.has(element.id) && element.isDeleted ? bump(element, false) : element)), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        };
      },
    });
    const needed = pictureFileIds(data.elements as unknown as ExcalidrawElement[]);
    void pictures.load(needed).then((loaded) => {
      if (loaded.length > 0) instance.addFiles(loaded);
      options.onPicturesLoaded(loaded.length);
    });
  }

  // Saves when the panel goes away, is hidden or the window closes.
  const flushNow = () => void flush();
  // Excalidraw's own copy as PNG uses the browser clipboard, which module pages cannot write; its shortcut copies
  // through Tavora instead (its menu item is hidden in style.css). Before Excalidraw sees the key.
  const copyKey = (event: KeyboardEvent) => {
    if (event.code !== "KeyC" || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    options.onCopyShortcut();
  };
  addEventListener("keydown", copyKey, true);
  addEventListener("pagehide", flushNow);
  document.addEventListener("visibilitychange", flushNow);

  return {
    change,
    ready,
    scroll: (scrollX, scrollY, zoom) => options.onView({ scrollX, scrollY, zoom: zoom.value }),
    recheckLocks: () => showSpots(true),
    flush,
    dispose() {
      removeEventListener("keydown", copyKey, true);
      removeEventListener("pagehide", flushNow);
      document.removeEventListener("visibilitychange", flushNow);
      cancelAnimationFrame(spotsFrame);
      clearTimeout(spotsRetry);
      void flush();
      options.onControls(null);
    },
  };
}
