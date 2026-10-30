// What a To-Dos panel shares with its groups and rows: this panel's own view
// (which to-do is being edited, what is folded, what just finished) and the
// undo offer. None of it is stored in the shared list.
import type { MenuOptions } from "@tavora/sdk";
import type { InjectionKey, Ref } from "vue";

/** What happens to a to-do once it is finished: it stays, struck through, or it vanishes after a moment. */
export type FinishedMode = "stay" | "vanish";

/** A new to-do being typed between others: it goes right after `afterId` and its sub-to-dos, at `level`. */
export interface Draft {
  groupId: string;
  afterId: string;
  level: number;
}

export interface PanelContext {
  finished: Ref<FinishedMode>;
  /** The to-do whose inline editor is open, if any. */
  editing: Ref<string | null>;
  /** The new to-do being typed between others, if any; only one at a time, and never while a title is edited. */
  draft: Ref<Draft | null>;
  /** To-dos whose sub-to-dos are hidden. */
  folded: Ref<string[]>;
  toggleFolded: (taskId: string) => void;
  /** Keeps a just-finished to-do on screen for a moment before it vanishes. */
  linger: (taskId: string, wasPinned: boolean) => void;
  lingering: Ref<ReadonlySet<string>>;
  /** Shows a toast that can put a change back. */
  offerUndo: (message: string, undo: () => void) => void;
  /** A menu Tavora draws above every panel (ui.showMenu): the chosen item's id, or null. */
  showMenu: (request: MenuOptions) => Promise<string | null>;
}

export const PANEL: InjectionKey<PanelContext> = Symbol("todos-panel");

/** How long a finished to-do stays before it vanishes; finishing another one restarts the wait for all. */
export const LINGER_MS = 1500;
export const UNDO_MS = 6000;

/** Folds a leaving row to nothing so the rows below slide up instead of jumping. */
export function collapse(element: Element, done: () => void): void {
  const node = element as HTMLElement;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return done();
  let finished = false;
  const finish = () => !finished && (finished = true) && done();
  node.style.height = `${node.offsetHeight}px`;
  node.style.overflow = "hidden";
  requestAnimationFrame(() => {
    node.style.transition = "height 220ms ease, opacity 180ms ease";
    node.style.height = "0px";
    node.style.opacity = "0";
  });
  node.addEventListener("transitionend", (event) => event.target === node && event.propertyName === "height" && finish());
  setTimeout(finish, 400);
}
