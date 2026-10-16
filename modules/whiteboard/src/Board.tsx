// One board in Excalidraw. Saves a moment after drawing stops, when the panel is hidden or closed, and when
// another board is opened. Remounted (key) for every board, so each starts with fresh undo history.
// Pictures (pasted, dropped or inserted) are kept in the file store and come back when the board is opened.

import { CaptureUpdateAction, Excalidraw, exportToBlob, MainMenu } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement, ExcalidrawImageElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { JsonValue, TavoraSDK } from "@tavora/sdk";
import { useEffect, useMemo, useRef } from "react";
import { MAX_BOARD_BYTES, sceneSignature, type BoardData } from "./boards";
import { COPY_PADDING, copyScale, elementsToCopy } from "./copy";
import { t, type Language } from "./i18n";
import { createPictures, pictureFileIds } from "./pictures";

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
}

export default function Board({ sdk, data, view, mode, language, onSave, onView, onState, onSize, onDirty, onPictures, onEmpty, onCopyShortcut, onPicturesLoaded, onNotice, onControls }: Props) {
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
  /** Pictures already on the board when it opened or seen once since; only a new one is locked. */
  const seen = useRef(new Set<string>((data.elements as unknown as ExcalidrawElement[]).filter((element) => element.type === "image").map((element) => element.id)));
  const summary = useRef("");
  const empty = useRef<boolean | null>(null);
  const theme = useRef(mode);
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

    // A picture that was just added is locked, so scribbling on top of it does not drag it around. Only once Excalidraw has
    // given it its file: until then it is still changing the element, and replacing the element would lose that.
    const live = elements.filter((element) => element.type === "image" && !element.isDeleted);
    const added = live.filter((element) => !seen.current.has(element.id) && (element as ExcalidrawImageElement).fileId !== null);
    if (added.length > 0) {
      for (const element of added) seen.current.add(element.id);
      const ids = new Set(added.map((element) => element.id));
      // After this change has been handled, not inside it.
      setTimeout(() => {
        const scene = api.current?.getSceneElements();
        if (!scene) return;
        api.current?.updateScene({
          elements: scene.map((element) => (ids.has(element.id) ? { ...element, locked: true, version: element.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() } : element)),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }, 0);
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
        await sdk.clipboard.writeImage(png);
        return elements.length < instance.getSceneElements().length ? "selection" : "board";
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

  const initialData = {
    elements: data.elements as unknown as readonly ExcalidrawElement[],
    appState: {
      viewBackgroundColor: data.background,
      ...(view ? { scrollX: view.scrollX, scrollY: view.scrollY, zoom: { value: view.zoom as never } } : {}),
    },
    scrollToContent: !view && data.elements.length > 0,
  };

  return (
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
        <MainMenu.DefaultItems.Help />
      </MainMenu>
    </Excalidraw>
  );
}
