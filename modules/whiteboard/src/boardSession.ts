// One board open in Excalidraw, without any framework: it follows what Excalidraw reports and keeps `state` for the page.
// Saving is the board saver's (boardSave.ts), a moment after drawing stops, when the panel is hidden or closed, and when
// another board is opened (the page makes a new session for every board, so each starts with fresh undo history).
// Pictures (pasted, dropped or inserted) are kept in the file store and come back when the board is opened.

import { CaptureUpdateAction, exportToBlob, getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { TavoraSDK } from "@tavora/sdk";
import type { DocumentHandle } from "@tavora/sdk/store";
import { createBoardSaver } from "./boardSave";
import { initialBoardState, type BoardState } from "./boardState";
import type { BoardData } from "./boards";
import { noteCard, pictureCard } from "./cards";
import { connectorHeads, type ConnectorKind } from "./connectors";
import { COPY_PADDING, copyScale, elementsToCopy } from "./copy";
import { revised } from "./elements";
import { isDrawingAt } from "./excalidrawDom";
import { t } from "./i18n";
import { createLockWatcher, lockSpots, type LockSpot } from "./locks";
import { createPlacing } from "./placing";
import { createPictures, pictureFileIds } from "./pictures";
import { readBoardPicture } from "./readPicture";

export type { BoardState, Pictures, SaveState, View } from "./boardState";

/** What the page can ask of the board it shows. */
export interface Controls {
  addNote(): void;
  addPicture(file: File): Promise<void>;
  setConnector(kind: ConnectorKind): void;
  setGrid(enabled: boolean): void;
  setPicturesLocked(locked: boolean): void;
  /** Locks or frees one picture. */
  setPictureLocked(id: string, locked: boolean): void;
  /** Puts the selection, or the whole board when nothing is selected, on the clipboard as a PNG. Call it from a click or key press. */
  copyAsPicture(): Promise<"selection" | "board">;
  /** Saves the same picture through Tavora's save dialog, named after `name`; null when the user closed it. Call it from a click or key press. */
  saveAsPicture(name: string): Promise<{ what: "selection" | "board"; fileName: string } | null>;
  /** Takes everything off the board, as one step that Undo brings back; returns how to put it all back. */
  clear(): () => void;
}

export interface SessionOptions {
  sdk: TavoraSDK;
  /** The board's document, opened by the board library; its data is what the board starts with. */
  document: DocumentHandle<BoardData>;
  /** Whether the panel is dark, for the pictures the board makes. */
  isDark(): boolean;
  /** Fit newly created starter content once; saved views retain their own pan and zoom. */
  fitOnOpen?: boolean;
}

export interface BoardSession extends Controls {
  /** What the page shows of the board; replaced (never changed) whenever any of it changes. */
  readonly state: BoardState;
  onState(fn: (state: BoardState) => void): () => void;
  /** A message for the user, such as a picture that cannot be kept. */
  onNotice(fn: (message: string) => void): () => void;
  /** Shift+Alt+C, Excalidraw's own shortcut for copying as PNG, which asks the page to copy. */
  onCopyShortcut(fn: () => void): () => void;
  imageAt(clientX: number, clientY: number): string | null;
  /** Excalidraw's onChange. */
  change(elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles): void;
  /** Excalidraw's excalidrawAPI. */
  ready(instance: ExcalidrawImperativeAPI): void;
  scroll(scrollX: number, scrollY: number, zoom: { value: number }): void;
  /** Looks again at which picture locks Excalidraw's menus cover (after the palette moved, say). */
  recheckLocks(): void;
  /** Saves what is not stored yet. */
  flush(): Promise<void>;
  /** Lets go without saving what is left (the board is being deleted). */
  discard(): void;
  /** Saves what is left and lets go of the page's listeners. */
  dispose(): Promise<void>;
}

export function createBoardSession(options: SessionOptions): BoardSession {
  const { sdk, document: doc } = options;
  const data = doc.data;
  const pictures = createPictures(sdk, data.files);
  const saver = createBoardSaver({ document: doc, pictures });
  const placing = createPlacing(data.elements as unknown as ExcalidrawElement[]);
  let api: ExcalidrawImperativeAPI | null = null;
  let disposed = false;
  let fitted = false;
  let summary = "";

  let state: BoardState = { ...initialBoardState(data), ...saver.state };
  const stateListeners = new Set<(state: BoardState) => void>();
  const noticeListeners = new Set<(message: string) => void>();
  const copyListeners = new Set<() => void>();
  const set = (patch: Partial<BoardState>) => {
    const next = { ...state, ...patch };
    if ((Object.keys(next) as (keyof BoardState)[]).every((key) => next[key] === state[key])) return;
    state = next;
    for (const fn of [...stateListeners]) fn(state);
  };
  const say = (message: string) => {
    for (const fn of [...noticeListeners]) fn(message);
  };
  const stopSaverState = saver.onState((next) => set(next));
  const stopProblems = saver.onProblem((problem) => say(problem.kind === "unsupported" ? t("image.unsupported", { type: problem.message }) : t("image.failed", { error: problem.message })));

  const locks = createLockWatcher({
    drawingAt: isDrawingAt,
    origin: () => ({ left: origin.left, top: origin.top }),
    onSpots: (spots) => set({ spots }),
  });
  let origin = { left: 0, top: 0 };

  function checkSpots(appState: AppState, live: readonly OrderedExcalidrawElement[]) {
    const spots: LockSpot[] = lockSpots(live, { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom.value, width: appState.width, height: appState.height }).map((spot) => ({
      ...spot,
      selected: !!appState.selectedElementIds[spot.id],
    }));
    origin = { left: appState.offsetLeft, top: appState.offsetTop };
    locks.update(spots, `${appState.activeTool.type}#${Object.keys(appState.selectedElementIds).length}#${appState.openMenu}#${appState.openPopup}#${appState.width}x${appState.height}`);
  }

  function change(elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) {
    saver.change({ elements, background: appState.viewBackgroundColor, grid: appState.gridModeEnabled, files });
    set({ grid: appState.gridModeEnabled });
    if (options.fitOnOpen && !fitted && api && elements.some((element) => !element.isDeleted)) {
      fitted = true;
      requestAnimationFrame(() => {
        if (!disposed) api?.scrollToContent(api.getSceneElements(), { fitToViewport: true, viewportZoomFactor: 0.75, maxZoom: 1, animate: false });
      });
    }

    const live = elements.filter((element) => element.type === "image" && !element.isDeleted);
    const placed = placing.observe(elements, appState.selectedElementIds);
    if (placed.length > 0) {
      const ids = new Set(placed);
      // After this change has been handled, not inside it.
      setTimeout(() => {
        const scene = api?.getSceneElements();
        if (!scene) return;
        api?.updateScene({
          elements: scene.map((element) => (ids.has(element.id) && !element.locked ? revised(element, { locked: true }) : element)),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }, 0);
    }
    checkSpots(appState, live);
    const description = `${live.length}:${live.every((element) => element.locked)}`;
    if (description !== summary) {
      summary = description;
      set({ pictures: { count: live.length, allLocked: live.length > 0 && live.every((element) => element.locked) } });
    }
    set({ empty: !elements.some((element) => !element.isDeleted) });
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
    const scene = instance.getSceneElements();
    const groups = new Set(scene.filter((element) => element.type === "image" && (!only || element.id === only) && element.customData?.whiteboardCard === "picture").flatMap((element) => element.groupIds));
    instance.updateScene({
      elements: instance.getSceneElements().map((element) => ((only ? element.id === only : element.type === "image") || element.groupIds.some((id) => groups.has(id)) ? revised(element, { locked }) : element)),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }

  /** Puts cards in the middle of what the user sees and selects them. */
  function insert(instance: ExcalidrawImperativeAPI, elements: ReturnType<typeof noteCard>) {
    const view = instance.getAppState();
    const [left, top, right, bottom] = getCommonBounds(elements);
    const dx = view.width / 2 / view.zoom.value - view.scrollX - (left + right) / 2;
    const dy = view.height / 2 / view.zoom.value - view.scrollY - (top + bottom) / 2;
    const placed = elements.map((element) => ({ ...element, x: element.x + dx, y: element.y + dy }));
    instance.updateScene({
      elements: [...instance.getSceneElementsIncludingDeleted(), ...placed],
      appState: {
        editingGroupId: null,
        selectedElementIds: Object.fromEntries(placed.map((element) => [element.id, true])),
        selectedGroupIds: Object.fromEntries(placed.flatMap((element) => element.groupIds.map((id) => [id, true]))),
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    instance.setActiveTool({ type: "selection" });
  }

  // Reads the board's stored pictures back once Excalidraw is ready.
  function ready(instance: ExcalidrawImperativeAPI) {
    api = instance;
    set({ ready: true });
    const needed = pictureFileIds(data.elements as unknown as ExcalidrawElement[]);
    void pictures.load(needed).then((loaded) => {
      if (loaded.length > 0) instance.addFiles(loaded);
      set({ picturesLoaded: loaded.length });
    });
  }

  // Saves when the panel goes away, is hidden or the window closes.
  const flushNow = () => void saver.flush();
  // Excalidraw's own copy as PNG uses the browser clipboard, which module pages cannot write; its shortcut copies
  // through Tavora instead (its menu item is hidden in style.css). Before Excalidraw sees the key.
  const copyKey = (event: KeyboardEvent) => {
    if (event.code !== "KeyC" || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    for (const fn of [...copyListeners]) fn();
  };
  addEventListener("keydown", copyKey, true);
  addEventListener("pagehide", flushNow);
  document.addEventListener("visibilitychange", flushNow);

  const listen = <F>(listeners: Set<F>, fn: F) => {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  };

  return {
    get state() {
      return state;
    },
    onState: (fn) => listen(stateListeners, fn),
    onNotice: (fn) => listen(noticeListeners, fn),
    onCopyShortcut: (fn) => listen(copyListeners, fn),

    addNote: () => api && insert(api, noteCard(0, 0, t("card.heading"), t("card.body"))),
    async addPicture(file) {
      const instance = api;
      if (!instance) return;
      const picture = await readBoardPicture(file);
      if (disposed) return;
      instance.addFiles([picture.binary]);
      insert(instance, pictureCard(0, 0, picture.binary.id, picture.width, picture.height, t("card.caption")));
    },
    setConnector(kind) {
      const instance = api;
      if (!instance) return;
      const heads = connectorHeads(kind);
      const selected = instance.getAppState().selectedElementIds;
      const editing = instance.getSceneElements().some((element) => element.type === "arrow" && selected[element.id] && !element.locked);
      instance.updateScene({
        elements: editing ? instance.getSceneElementsIncludingDeleted().map((element) => (element.type === "arrow" && selected[element.id] && !element.locked ? revised(element, heads) : element)) : undefined,
        appState: { currentItemStartArrowhead: heads.startArrowhead, currentItemEndArrowhead: heads.endArrowhead, currentItemRoughness: 0 },
        captureUpdate: editing ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.NEVER,
      });
      instance.setActiveTool({ type: editing ? "selection" : "arrow" });
    },
    setGrid(enabled) {
      api?.updateScene({ appState: { gridModeEnabled: enabled }, captureUpdate: CaptureUpdateAction.NEVER });
    },
    setPicturesLocked: (locked) => api && setLocked(api, locked),
    setPictureLocked(id, locked) {
      if (!api) return;
      placing.release(id);
      setLocked(api, locked, id);
    },
    async copyAsPicture() {
      if (!api) throw new Error("the board is not ready");
      const picture = await pictureOf(api);
      await sdk.clipboard.writeImage(picture.png);
      return picture.what;
    },
    async saveAsPicture(name) {
      if (!api) throw new Error("the board is not ready");
      const picture = await pictureOf(api);
      const saved = await sdk.pictures.save(picture.png, name);
      return saved && { what: picture.what, fileName: saved.fileName };
    },
    clear() {
      const instance = api;
      if (!instance) return () => undefined;
      const before = instance.getSceneElements();
      instance.updateScene({ elements: before.map((element) => revised(element, { isDeleted: true }, 2)), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      return () => {
        const ids = new Set(before.map((element) => element.id));
        const now = instance.getSceneElementsIncludingDeleted();
        instance.updateScene({ elements: now.map((element) => (ids.has(element.id) && element.isDeleted ? revised(element, { isDeleted: false }, 2) : element)), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      };
    },

    imageAt(clientX, clientY) {
      if (!api || !isDrawingAt(clientX, clientY)) return null;
      const view = api.getAppState();
      const x = (clientX - view.offsetLeft) / view.zoom.value - view.scrollX;
      const y = (clientY - view.offsetTop) / view.zoom.value - view.scrollY;
      for (const image of [...api.getSceneElements()].reverse()) {
        if (image.type !== "image" || image.isDeleted) continue;
        const dx = x - image.x - image.width / 2;
        const dy = y - image.y - image.height / 2;
        const localX = dx * Math.cos(image.angle) + dy * Math.sin(image.angle);
        const localY = -dx * Math.sin(image.angle) + dy * Math.cos(image.angle);
        if (Math.abs(localX) <= image.width / 2 && Math.abs(localY) <= image.height / 2) return image.id;
      }
      return null;
    },
    change,
    ready,
    scroll: (scrollX, scrollY, zoom) => set({ view: { scrollX, scrollY, zoom: zoom.value } }),
    recheckLocks: () => locks.recheck(),
    flush: () => saver.flush(),
    discard: () => saver.discard(),
    async dispose() {
      disposed = true;
      removeEventListener("keydown", copyKey, true);
      removeEventListener("pagehide", flushNow);
      document.removeEventListener("visibilitychange", flushNow);
      locks.dispose();
      await saver.dispose();
      stopSaverState();
      stopProblems();
      set({ ready: false });
      stateListeners.clear();
      noticeListeners.clear();
      copyListeners.clear();
    },
  };
}
