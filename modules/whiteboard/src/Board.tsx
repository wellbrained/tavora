// One board in Excalidraw. Saves a moment after drawing stops, when the panel is hidden or closed, and when
// another board is opened. Remounted (key) for every board, so each starts with fresh undo history.
// Pictures (pasted, dropped or inserted) are kept in the file store and come back when the board is opened.

import { CaptureUpdateAction, Excalidraw, exportToBlob, MainMenu } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement, ExcalidrawImageElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { JsonValue, TavoraSDK } from "@tavora/sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_BOARD_BYTES, sceneSignature, type BoardData } from "./boards";
import { COPY_PADDING, copyScale, elementsToCopy } from "./copy";
import { t, type Language } from "./i18n";
import { createPictures, pictureFileIds } from "./pictures";
import PictureLocks, { lockSpots, spotsKey, type LockSpot } from "./PictureLocks";

/** How long drawing must pause before the board is saved. */
const SAVE_DELAY_MS = 600;

export interface View {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export type SaveState = "idle" | "saving" | "saved" | "error";

/** What the page can ask of the board it shows. */
export interface Controls {
  setPicturesLocked(locked: boolean): void;
  /** Puts the selection, or the whole board when nothing is selected, on the clipboard as a PNG. Call it from a click or key press. */
  copyAsPicture(): Promise<"selection" | "board">;
  /** Saves the same picture as a file in Pictures\Tavora, named after `name`. Call it from a click or key press. */
  /** Null when the player closed the save dialog. */
  saveAsPicture(name: string): Promise<{ what: "selection" | "board"; fileName: string } | null>;
  /** Takes everything off the board, as one step that Undo brings back; returns how to put it all back. */
  clear(): () => void;
}

/** The pictures on the board: how many, and whether they are all locked. */
export interface Pictures {
  count: number;
  allLocked: boolean;
}

interface Props {
  sdk: TavoraSDK;
  data: BoardData;
  view: View | undefined;
  mode: "light" | "dark";
  language: Language;
  /** Stores the board. Resolves once it is stored, rejects when it could not be. */
  onSave(data: BoardData): Promise<void>;
  onView(view: View): void;
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
  /** Where the toolbar is, for the menu item that moves it. */
  toolbar: "top" | "bottom";
  onToolbar(place: "top" | "bottom"): void;
}

export default function Board({ sdk, data, view, mode, language, onSave, onView, onState, onSize, onDirty, onPictures, onEmpty, onCopyShortcut, onPicturesLoaded, onNotice, onControls, toolbar, onToolbar }: Props) {
  // The newest drawing, and what was last stored, kept outside React's render so drawing never waits for it.
  const latest = useRef<{ elements: readonly OrderedExcalidrawElement[]; background: string; files: BinaryFiles } | null>(null);
  const pictures = useMemo(() => createPictures(sdk, data.files), [sdk, data.files]);
  /**
   * What identifies a drawing: its elements and background, and which of its pictures have their pixels. Excalidraw adds
   * a picture's element first and its pixels a moment later, so the second step must count as a change to save.
   */
  const signatureOf = (elements: readonly OrderedExcalidrawElement[], background: string, files: BinaryFiles) =>
    `${sceneSignature(elements, background)}|${pictureFileIds(elements).filter((id) => files[id] || pictures.stored.has(id)).join(",")}`;
  const first = signatureOf(data.elements as unknown as OrderedExcalidrawElement[], data.background, {});
  /** The drawing last stored, and the drawing last handed to a save (a save may still be running). */
  const stored = useRef(first);
  const queued = useRef(first);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const props = useRef({ data, onSave, onState, onSize, onDirty, onNotice, onCopyShortcut });
  props.current = { data, onSave, onState, onSize, onDirty, onNotice, onCopyShortcut };
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  /** Pictures already on the board when it opened or seen once since; only a new one is locked (once it is placed). */
  const seen = useRef(new Set<string>((data.elements as unknown as ExcalidrawElement[]).filter((element) => element.type === "image").map((element) => element.id)));
  /** New pictures that are still being placed: they are locked once they are no longer selected. */
  const placing = useRef(new Set<string>());
  const summary = useRef("");
  const empty = useRef<boolean | null>(null);
  const theme = useRef(mode);
  const [spots, setSpots] = useState<LockSpot[]>([]);
  const spotsSeen = useRef("");
  theme.current = mode;

  function flush(): Promise<void> {
    clearTimeout(timer.current);
    timer.current = undefined;
    const scene = latest.current;
    if (!scene) return saving.current;
    const signature = signatureOf(scene.elements, scene.background, scene.files);
    if (signature === queued.current) return saving.current;
    queued.current = signature;
    props.current.onState("saving");
    saving.current = saving.current
      .then(async () => {
        // Pictures first: the file store keeps their pixels, the board only the stored file's id.
        const synced = await pictures.sync(scene.elements, scene.files);
        for (const problem of synced.problems) {
          props.current.onNotice(problem.kind === "unsupported" ? t("image.unsupported", { type: problem.message }) : t("image.failed", { error: problem.message }));
        }
        const next: BoardData = {
          ...props.current.data,
          // Through JSON so the stored copy is plain data (Excalidraw leaves some fields undefined).
          elements: JSON.parse(JSON.stringify(scene.elements.filter((element) => !element.isDeleted))) as JsonValue[],
          files: synced.files,
          background: scene.background,
        };
        const bytes = JSON.stringify(next).length;
        props.current.onSize(bytes);
        if (bytes > MAX_BOARD_BYTES) throw new Error("the board is too big to save");
        await props.current.onSave(next);
      })
      .then(
        () => {
          stored.current = signature;
          // Saved, unless more was drawn meanwhile: that has its own save coming.
          if (queued.current === signature && !timer.current) {
            props.current.onDirty(false);
            props.current.onState("saved");
          }
        },
        (reason: unknown) => {
          console.error("[whiteboard] could not save", reason);
          queued.current = stored.current;
          props.current.onState("error");
        },
      );
    return saving.current;
  }

  function onChange(elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) {
    latest.current = { elements, background: appState.viewBackgroundColor, files };

    // A picture that was just added stays free while it is selected, so it can be dragged into place first. Once it is
    // let go of (something else is selected, or nothing), it is locked, so scribbling on top of it does not drag it
    // around. Only once Excalidraw has given it its file: until then it is still changing the element.
    const live = elements.filter((element) => element.type === "image" && !element.isDeleted);
    for (const element of live) if (!seen.current.has(element.id)) placing.current.add(element.id);
    const placed = live.filter((element) => placing.current.has(element.id) && (element as ExcalidrawImageElement).fileId !== null && !appState.selectedElementIds[element.id]);
    if (placed.length > 0) {
      for (const element of placed) placing.current.delete(element.id);
      const ids = new Set(placed.map((element) => element.id));
      // After this change has been handled, not inside it.
      setTimeout(() => {
        const scene = api.current?.getSceneElements();
        if (!scene) return;
        api.current?.updateScene({
          elements: scene.map((element) => (ids.has(element.id) && !element.locked ? { ...element, locked: true, version: element.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() } : element)),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }, 0);
    }
    for (const element of live) seen.current.add(element.id);
    // A lock that would lie under Excalidraw's menus (the palette, the toolbar, …) is left out.
    const nextSpots = lockSpots(live, { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom.value, width: appState.width, height: appState.height }).filter((spot) =>
      document
        .elementsFromPoint(appState.offsetLeft + spot.x, appState.offsetTop + spot.y)
        .find((element) => !element.closest(".picture-locks"))
        ?.matches("canvas"),
    );
    const key = spotsKey(nextSpots);
    if (key !== spotsSeen.current) {
      spotsSeen.current = key;
      setSpots(nextSpots);
    }
    const description = `${live.length}:${live.every((element) => element.locked)}`;
    if (description !== summary.current) {
      summary.current = description;
      onPictures({ count: live.length, allLocked: live.length > 0 && live.every((element) => element.locked) });
    }
    const nothing = !elements.some((element) => !element.isDeleted);
    if (nothing !== empty.current) {
      empty.current = nothing;
      onEmpty(nothing);
    }

    if (signatureOf(elements, appState.viewBackgroundColor, files) === queued.current) return;
    props.current.onDirty(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
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
      appState: { exportBackground: true, viewBackgroundColor: appState.viewBackgroundColor, exportWithDarkMode: theme.current === "dark" },
      mimeType: "image/png",
      exportPadding: COPY_PADDING,
      getDimensions: (width: number, height: number) => {
        const scale = copyScale(width, height);
        return { width: Math.round(width * scale), height: Math.round(height * scale), scale };
      },
    });
    return { png, what: elements.length < instance.getSceneElements().length ? "selection" : "board" };
  }

  // Reads the board's stored pictures back once Excalidraw is ready.
  function ready(instance: ExcalidrawImperativeAPI) {
    api.current = instance;
    onControls({
      setPicturesLocked: (locked) =>
        instance.updateScene({
          elements: instance.getSceneElements().map((element) => (element.type === "image" ? { ...element, locked, version: element.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() } : element)),
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        }),
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
        const bump = <T extends ExcalidrawElement>(element: T, isDeleted: boolean): T => ({ ...element, isDeleted, version: element.version + 2, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() });
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
      onPicturesLoaded(loaded.length);
    });
  }

  // Saves when the panel goes away, is hidden or the window closes.
  useEffect(() => {
    const flushNow = () => void flush();
    // Excalidraw's own copy as PNG uses the browser clipboard, which module pages cannot write; its shortcut copies
    // through Tavora instead (its menu item is hidden in style.css). Before Excalidraw sees the key.
    const copyKey = (event: KeyboardEvent) => {
      if (event.code !== "KeyC" || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      props.current.onCopyShortcut();
    };
    addEventListener("keydown", copyKey, true);
    addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", flushNow);
    return () => {
      removeEventListener("keydown", copyKey, true);
      removeEventListener("pagehide", flushNow);
      document.removeEventListener("visibilitychange", flushNow);
      void flush();
      onControls(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An empty board has nothing to come back to, so it opens at 100%. A zoom left from before (up to 3000%) would make
  // every stroke drawn next far too thick, with nothing on the board to show why.
  const start = data.elements.length > 0 ? view : undefined;
  const initialData = {
    elements: data.elements as unknown as readonly ExcalidrawElement[],
    appState: {
      viewBackgroundColor: data.background,
      ...(start ? { scrollX: start.scrollX, scrollY: start.scrollY, zoom: { value: start.zoom as never } } : {}),
    },
    scrollToContent: !start && data.elements.length > 0,
  };

  function setPictureLocked(id: string, locked: boolean) {
    const instance = api.current;
    if (!instance) return;
    placing.current.delete(id);
    instance.updateScene({
      elements: instance.getSceneElements().map((element) => (element.id === id ? { ...element, locked, version: element.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() } : element)),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }

  return (
    <>
      <Excalidraw
        initialData={initialData}
        excalidrawAPI={ready}
        onChange={onChange}
        onScrollChange={(scrollX, scrollY, zoom) => onView({ scrollX, scrollY, zoom: zoom.value })}
        langCode={language === "de" ? "de-DE" : "en"}
        theme={mode}
        // The panel shares the page with nothing else, but shortcuts are still only for the focused drawing.
        handleKeyboardGlobally={false}
        autoFocus
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false },
        }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        <MainMenu.Item data-testid="toolbar-place" onSelect={() => onToolbar(toolbar === "bottom" ? "top" : "bottom")}>
          {t(toolbar === "bottom" ? "toolbar.top" : "toolbar.bottom")}
        </MainMenu.Item>
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>
      <PictureLocks spots={spots} onToggle={setPictureLocked} />
    </>
  );
}
