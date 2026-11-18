// What a to-do row offers, shared by the panel's rows (TaskRow.vue) and the list over the game (EditPlate.vue):
// finishing, deleting and renaming with the same Undo, and the row's menu (drawn by RowMenuItems.vue).
import { AlignLeft, ArrowDown, ArrowUp, CornerDownRight, FolderInput, IndentDecrease, IndentIncrease, ListPlus, Pencil, Pin, PinOff, Trash2 } from "@lucide/vue";
import type { FocusRecovery } from "@tavora/official-ui";
import type { Component } from "vue";
import { t } from "./i18n";
import type { PanelContext } from "./panel";
import type { TodoStore } from "./store";
import {
  canIndent,
  canRestoreBlock,
  canShift,
  deleteTask,
  doneState,
  indentTask,
  MAX_DEPTH,
  moveTask,
  outdentTask,
  removedBlock,
  restoreBlock,
  restoreDone,
  setDone,
  shiftTask,
  updateTask,
  type Group,
  type Task,
  type TodoList,
} from "./todos";

/**
 * Changes to one to-do at a time. A change may run again on a newer list when another panel saved first, so every
 * value it uses is read when it is made, never inside it.
 */
export function taskActions(store: TodoStore, panel: Pick<PanelContext, "linger" | "offerUndo">, rowFocus: FocusRecovery | null) {
  const change = (fn: Parameters<TodoStore["apply"]>[0]) => void store.apply(fn);
  return {
    change,
    /** Ticks or unticks a to-do. A finished one stays a moment, and Undo puts it and its sub-to-dos back as they were. */
    setDone(task: Task, done: boolean) {
      const at = new Date().toISOString();
      const before = doneState(store.list.value, task.id);
      const taskId = task.id;
      if (done) panel.linger(taskId, task.pinned);
      change((data) => setDone(data, taskId, done, at));
      if (done)
        panel.offerUndo(t("app.undoFinished", { title: task.title }), () => {
          change((data) => restoreDone(data, before));
          rowFocus?.restore(taskId);
        });
    },
    /** Deletes a to-do with its sub-to-dos at once; Undo puts them back where they were. */
    remove(task: Task) {
      const removed = removedBlock(store.list.value, task.id);
      const taskId = task.id;
      change((data) => deleteTask(data, taskId));
      if (!removed) return;
      panel.offerUndo(t("app.undoDeleted", { title: task.title }), () => {
        // Checked on the list as it is now (its group may be gone since); the change may run again on a newer one.
        if (!canRestoreBlock(store.list.value, removed)) return false;
        store.apply((data) => void restoreBlock(data, removed));
        rowFocus?.restore(taskId);
      });
    },
    /** A new title: one line (pasted line breaks become spaces); an empty or unchanged one changes nothing. */
    rename(task: Task, title: string) {
      const taskId = task.id;
      const next = title.replace(/\s*\n\s*/g, " ");
      if (next.trim() && next.trim() !== task.title) change((data) => updateTask(data, taskId, { title: next }));
    },
  };
}

/** What a row's menu entry does; `move:<group id>` moves the to-do to the end of that group. */
export type RowAction = "rename" | "describe" | "pin" | "add-below" | "add-sub" | "indent" | "outdent" | "up" | "down" | "delete" | `move:${string}`;

export interface RowMenuItem {
  type: "item";
  id: RowAction;
  label: string;
  icon?: Component;
  disabled?: boolean;
  /** Why it is off, shown while it is. */
  disabledReason?: string;
  danger?: boolean;
  testid?: string;
}

export type RowMenuEntry = RowMenuItem | { type: "separator" } | { type: "submenu"; label: string; icon: Component; items: RowMenuItem[] };

export interface RowMenuFor {
  task: Task;
  group: Group;
  groups: readonly Group[];
  /** The to-do's place in its group's tasks. */
  index: number;
  depth: number;
  /** An objective: no nesting or moving, as in the panel's objectives. */
  compact?: boolean;
  /** Offer Rename (over the game, where the title is renamed by a double-click or from here). */
  rename?: boolean;
  /** Offer the description (the panel, which shows it); off over the game, where nothing shows it. */
  describe?: boolean;
}

/** A row's menu: the panel's ⋯ and right-click, and ⋯ over the game. */
export function rowMenu(row: RowMenuFor): RowMenuEntry[] {
  const { task, group, index, depth } = row;
  const entries: RowMenuEntry[] = [];
  if (row.rename) entries.push({ type: "item", id: "rename", label: t("task.rename"), icon: Pencil, testid: "menu-rename" });
  if (row.describe !== false)
    entries.push({ type: "item", id: "describe", label: task.details ? t("task.editDescription") : t("task.addDescription"), icon: AlignLeft, testid: "menu-description" });
  entries.push({ type: "item", id: "pin", label: task.pinned ? t("task.unpin") : t("task.pin"), icon: task.pinned ? PinOff : Pin, testid: "menu-pin" });
  if (!row.compact) {
    entries.push(
      { type: "item", id: "add-below", label: t("task.addBelow"), icon: ListPlus, testid: "menu-add-below" },
      { type: "item", id: "add-sub", label: t("task.addSub"), icon: CornerDownRight, disabled: depth >= MAX_DEPTH, disabledReason: t("task.addSub.off", { count: MAX_DEPTH }), testid: "menu-add-sub" },
      { type: "separator" },
      { type: "item", id: "indent", label: t("task.indent"), icon: IndentIncrease, disabled: !canIndent(group, index), disabledReason: t("task.indent.off"), testid: "menu-indent" },
      { type: "item", id: "outdent", label: t("task.outdent"), icon: IndentDecrease, disabled: !task.parentId, disabledReason: t("task.outdent.off"), testid: "menu-outdent" },
      { type: "item", id: "up", label: t("task.moveUp"), icon: ArrowUp, disabled: !canShift(group, index, -1) },
      { type: "item", id: "down", label: t("task.moveDown"), icon: ArrowDown, disabled: !canShift(group, index, 1) },
    );
    const others = row.groups.filter((other) => other.id !== group.id);
    if (others.length)
      entries.push({ type: "submenu", label: t("task.moveToGroup"), icon: FolderInput, items: others.map((target) => ({ type: "item", id: `move:${target.id}`, label: target.name })) });
  }
  entries.push({ type: "separator" }, { type: "item", id: "delete", label: t("task.delete"), icon: Trash2, danger: true, testid: "menu-delete" });
  return entries;
}

/** The change an entry makes to the list by itself, or null for one the row carries out (rename, description, new to-dos, delete). */
export function rowChange(action: RowAction, task: Task): ((data: TodoList) => void) | null {
  const taskId = task.id;
  if (action === "pin") {
    const pinned = !task.pinned;
    return (data) => updateTask(data, taskId, { pinned });
  }
  if (action === "indent") return (data) => indentTask(data, taskId);
  if (action === "outdent") return (data) => outdentTask(data, taskId);
  if (action === "up") return (data) => shiftTask(data, taskId, -1);
  if (action === "down") return (data) => shiftTask(data, taskId, 1);
  if (action.startsWith("move:")) {
    const groupId = action.slice("move:".length);
    return (data) => moveTask(data, taskId, groupId, null);
  }
  return null;
}

/**
 * A menu entry that needs the focus (an editor, a new to-do) waits until the menu has closed and let go of it: `later`
 * keeps it, and the menu's close-auto-focus runs it instead of putting the focus back on ⋯.
 */
export function afterMenu() {
  let pending: (() => void) | null = null;
  return {
    later(run: () => void) {
      pending = run;
    },
    closed(event: Event) {
      const run = pending;
      if (!run) return;
      pending = null;
      event.preventDefault();
      run();
    },
  };
}
