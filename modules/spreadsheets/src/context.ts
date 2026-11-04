// What a Spreadsheets panel shares with its parts (toolbar, formula bar, grid, sheet tabs): the open spreadsheet's
// session, this panel's selection and edit, and the actions that need the whole panel (files, menus, messages).
import type { GridEdit, GridRange, GridSelection } from "@tavora/official-ui/components/ui/data-grid";
import type { MenuOptions } from "@tavora/sdk";
import type { ComputedRef, InjectionKey, Ref, ShallowRef } from "vue";
import type { Lang } from "./formula/locale";
import type { Refusal, Session } from "./session";
import type { SpreadsheetEntry } from "./store";
import type { TemplateId } from "./templates";

export interface GridApi {
  focus(): void;
  scrollToCell(cell: { row: number; col: number }): void;
  startEditing(text?: string, mode?: GridEdit["mode"]): void;
  commitEdit(move?: { key: "Enter" | "Tab"; shift?: boolean }): void;
  cancelEdit(): void;
  cellElement(cell: { row: number; col: number }): HTMLElement | null;
  editorElement(): HTMLTextAreaElement | null;
}

export interface PanelContext {
  session: ShallowRef<Session | null>;
  lang: ComputedRef<Lang>;
  selection: Ref<GridSelection>;
  range: ComputedRef<GridRange>;
  editing: Ref<GridEdit | null>;
  grid: ShallowRef<GridApi | null>;
  spreadsheets: ComputedRef<SpreadsheetEntry[]>;
  currentId: Ref<string | null>;
  /** A menu Tavora draws next to `anchor`; the chosen id or null. Only from a click or key press. */
  showMenu(request: MenuOptions): Promise<string | null>;
  /** Says what a change couldn't do. */
  refused(refusal: Refusal | null): void;
  /** Opens one of the dialogs of the panel. */
  openDialog(kind: "rename" | "dropdown" | "sort"): void;
  open(id: string): void;
  create(template: TemplateId): void;
  duplicate(): void;
  remove(): void;
  runFileAction(id: string): void;
  showInGame(on: boolean): void;
  openSettings(): void;
  /** Whether this panel's live view shows something now. */
  liveOn: ComputedRef<boolean>;
}

export const PANEL: InjectionKey<PanelContext> = Symbol("spreadsheets-panel");
