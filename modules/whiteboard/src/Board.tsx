// One board in Excalidraw. Saves a moment after drawing stops, when the panel is hidden or closed, and when
// another board is opened. Remounted (key) for every board, so each starts with fresh undo history.

import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import type { JsonValue } from "@tavora/sdk";
import { useEffect, useRef } from "react";
import { MAX_BOARD_BYTES, sceneSignature, type BoardData } from "./boards";
import type { Language } from "./i18n";

/** How long drawing must pause before the board is saved. */
const SAVE_DELAY_MS = 600;

export interface View {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export type SaveState = "idle" | "saving" | "saved" | "error";

interface Props {
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
}

export default function Board({ data, view, mode, language, onSave, onView, onState, onSize, onDirty }: Props) {
  // The newest drawing, and what was last stored, kept outside React's render so drawing never waits for it.
  const latest = useRef<{ elements: readonly OrderedExcalidrawElement[]; background: string } | null>(null);
  const first = sceneSignature(data.elements as unknown as OrderedExcalidrawElement[], data.background);
  /** The drawing last stored, and the drawing last handed to a save (a save may still be running). */
  const stored = useRef(first);
  const queued = useRef(first);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const props = useRef({ data, onSave, onState, onSize, onDirty });
  props.current = { data, onSave, onState, onSize, onDirty };

  function flush(): Promise<void> {
    clearTimeout(timer.current);
    timer.current = undefined;
    const scene = latest.current;
    if (!scene) return saving.current;
    const signature = sceneSignature(scene.elements, scene.background);
    if (signature === queued.current) return saving.current;
    const next: BoardData = {
      ...props.current.data,
      // Through JSON so the stored copy is plain data (Excalidraw leaves some fields undefined).
      elements: JSON.parse(JSON.stringify(scene.elements.filter((element) => !element.isDeleted))) as JsonValue[],
      background: scene.background,
    };
    const bytes = JSON.stringify(next).length;
    props.current.onSize(bytes);
    if (bytes > MAX_BOARD_BYTES) {
      props.current.onState("error");
      return saving.current;
    }
    queued.current = signature;
    props.current.onState("saving");
    saving.current = saving.current
      .then(() => props.current.onSave(next))
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

  function onChange(elements: readonly OrderedExcalidrawElement[], appState: AppState) {
    latest.current = { elements, background: appState.viewBackgroundColor };
    if (sceneSignature(elements, appState.viewBackgroundColor) === queued.current) return;
    props.current.onDirty(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }

  // Saves when the panel goes away, is hidden or the window closes.
  useEffect(() => {
    const flushNow = () => void flush();
    addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", flushNow);
    return () => {
      removeEventListener("pagehide", flushNow);
      document.removeEventListener("visibilitychange", flushNow);
      void flush();
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
  } satisfies ExcalidrawInitialDataState;

  return (
    <Excalidraw
      initialData={initialData}
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
