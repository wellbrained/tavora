// The one React part of the module: Excalidraw itself, with its footer and main menu. BoardView.vue mounts it with
// createRoot and hands it everything it needs as props, texts included, so nothing else here knows about Vue.

import { Excalidraw, Footer, MainMenu } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export interface RootProps {
  initialData: {
    elements: readonly ExcalidrawElement[];
    appState: Partial<AppState>;
    scrollToContent: boolean;
  };
  /** "de-DE" or "en". */
  langCode: string;
  theme: "light" | "dark";
  saveState: "idle" | "saving" | "saved" | "error";
  /** What the footer says about the save, already in the player's language. */
  saveText: string;
  /** The main menu item that moves the toolbar, already in the player's language. */
  toolbarText: string;
  onToolbarMove(): void;
  onApi(api: ExcalidrawImperativeAPI): void;
  onChange(elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles): void;
  onScroll(scrollX: number, scrollY: number, zoom: { value: number }): void;
}

export default function ExcalidrawRoot({ initialData, langCode, theme, saveState, saveText, toolbarText, onToolbarMove, onApi, onChange, onScroll }: RootProps) {
  return (
    <Excalidraw
      initialData={initialData}
      excalidrawAPI={onApi}
      onChange={onChange}
      onScrollChange={(scrollX, scrollY, zoom) => onScroll(scrollX, scrollY, zoom)}
      langCode={langCode}
      theme={theme}
      // The panel shares the page with nothing else, but shortcuts are still only for the focused drawing.
      handleKeyboardGlobally={false}
      autoFocus
      UIOptions={{
        canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false },
      }}
    >
      <Footer>
        <span className={saveState === "error" ? "save save-error" : "save"} role="status" data-testid="save-state" data-state={saveState}>
          {saveText}
        </span>
      </Footer>
      <MainMenu>
        <MainMenu.DefaultItems.ClearCanvas />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
        <MainMenu.Item data-testid="toolbar-place" onSelect={onToolbarMove}>
          {toolbarText}
        </MainMenu.Item>
        <MainMenu.DefaultItems.Help />
      </MainMenu>
    </Excalidraw>
  );
}
