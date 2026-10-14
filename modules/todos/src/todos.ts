// The data side of To-Dos: one document per game holds every group and
// task, and each change is a pure function on it. Changes take their new ids
// as arguments, so re-applying one after another panel saved first gives the
// same result.

import type { JsonValue } from "@tavora/sdk";

/** The document every To-Dos panel of a game shares. */
export const LIST_ID = "todos";
export const LIST_TITLE = "To-Dos";
/** The group a first to-do goes into when there is none yet. */
export const DEFAULT_GROUP = "To-Dos";

export const MAX = { groupName: 80, title: 300, details: 5000, link: 2000 } as const;

export interface Step {
  [key: string]: JsonValue;
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  [key: string]: JsonValue;
  id: string;
  title: string;
  done: boolean;
  /** Optional longer text. */
  details: string;
  /** Optional web address where the task came from, such as a guide. */
  link: string;
  /** Pinned tasks are shown as current objectives at the top. */
  pinned: boolean;
  steps: Step[];
  createdAt: string;
  doneAt: string | null;
}

export interface Group {
  [key: string]: JsonValue;
  id: string;
  name: string;
  tasks: Task[];
}

export interface TodoList {
  [key: string]: JsonValue;
  version: 1;
  groups: Group[];
}

// ── Reading stored data ──────────────────────────────────────────────

type JsonObject = { [key: string]: JsonValue };

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: JsonValue | undefined, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function list(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

/** Keeps the first of each id, so a bad write cannot make two rows act as one. */
function unique<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => item.id !== "" && !seen.has(item.id) && seen.add(item.id));
}

/** Turns stored data, or null for a new game, into a valid list. */
export function parseList(raw: JsonValue | null): TodoList {
  const groups = isObject(raw ?? null) ? list((raw as JsonObject).groups) : [];
  return {
    version: 1,
    groups: unique(
      groups.map((group) => ({
        id: text(group.id, 64),
        name: text(group.name, MAX.groupName) || DEFAULT_GROUP,
        tasks: unique(list(group.tasks).map(parseTask)),
      })),
    ),
  };
}

function parseTask(task: JsonObject): Task {
  const done = task.done === true;
  return {
    id: text(task.id, 64),
    title: text(task.title, MAX.title),
    done,
    details: text(task.details, MAX.details),
    link: text(task.link, MAX.link),
    pinned: task.pinned === true,
    steps: unique(
      list(task.steps).map((step) => ({ id: text(step.id, 64), title: text(step.title, MAX.title), done: step.done === true })),
    ),
    createdAt: text(task.createdAt, 40),
    doneAt: done && typeof task.doneAt === "string" ? task.doneAt.slice(0, 40) : null,
  };
}

// ── Looking things up ────────────────────────────────────────────────

export function findTask(data: TodoList, taskId: string): { group: Group; task: Task; index: number } | undefined {
  for (const group of data.groups) {
    const index = group.tasks.findIndex((task) => task.id === taskId);
    if (index !== -1) return { group, task: group.tasks[index]!, index };
  }
  return undefined;
}

/** Pinned tasks across all groups, in list order. */
export function pinnedTasks(data: TodoList): { group: Group; task: Task }[] {
  return data.groups.flatMap((group) => group.tasks.filter((task) => task.pinned).map((task) => ({ group, task })));
}

export function openCount(group: Group): number {
  return group.tasks.filter((task) => !task.done).length;
}

// ── Changes ──────────────────────────────────────────────────────────
// Each one changes `data` in place and quietly does nothing when its target
// was removed by another panel in the meantime.

export function addGroup(data: TodoList, id: string, name: string, index = data.groups.length): void {
  const clean = name.trim().slice(0, MAX.groupName);
  if (!clean || data.groups.some((group) => group.id === id)) return;
  data.groups.splice(clamp(index, 0, data.groups.length), 0, { id, name: clean, tasks: [] });
}

export function renameGroup(data: TodoList, groupId: string, name: string): void {
  const group = data.groups.find((item) => item.id === groupId);
  const clean = name.trim().slice(0, MAX.groupName);
  if (group && clean) group.name = clean;
}

export function deleteGroup(data: TodoList, groupId: string): void {
  data.groups = data.groups.filter((group) => group.id !== groupId);
}

/** Moves a group up (-1) or down (+1). */
export function moveGroup(data: TodoList, groupId: string, delta: number): void {
  const from = data.groups.findIndex((group) => group.id === groupId);
  if (from === -1) return;
  const [group] = data.groups.splice(from, 1);
  data.groups.splice(clamp(from + delta, 0, data.groups.length), 0, group!);
}

export interface NewTask {
  id: string;
  title: string;
  createdAt: string;
}

/**
 * Adds a task at the end of a group. With no group id, or when that group
 * is gone, it goes into the first group, which is created if there is none.
 */
export function addTask(data: TodoList, groupId: string | null, task: NewTask, newGroupId: string): void {
  const title = task.title.trim().slice(0, MAX.title);
  if (!title || findTask(data, task.id)) return;
  let group = data.groups.find((item) => item.id === groupId) ?? data.groups[0];
  if (!group) {
    addGroup(data, newGroupId, DEFAULT_GROUP);
    group = data.groups[0]!;
  }
  group.tasks.push({
    id: task.id,
    title,
    done: false,
    details: "",
    link: "",
    pinned: false,
    steps: [],
    createdAt: task.createdAt,
    doneAt: null,
  });
}

export type TaskPatch = Partial<Pick<Task, "title" | "details" | "link" | "pinned">>;

export function updateTask(data: TodoList, taskId: string, patch: TaskPatch): void {
  const found = findTask(data, taskId);
  if (!found) return;
  const { task } = found;
  if (patch.title !== undefined) {
    const title = patch.title.trim().slice(0, MAX.title);
    if (title) task.title = title;
  }
  if (patch.details !== undefined) task.details = patch.details.slice(0, MAX.details);
  if (patch.link !== undefined) task.link = patch.link.trim().slice(0, MAX.link);
  if (patch.pinned !== undefined) task.pinned = patch.pinned;
}

export function setDone(data: TodoList, taskId: string, done: boolean, at: string): void {
  const found = findTask(data, taskId);
  if (!found) return;
  found.task.done = done;
  found.task.doneAt = done ? at : null;
  // A finished objective is no longer current.
  if (done) found.task.pinned = false;
}

export function deleteTask(data: TodoList, taskId: string): void {
  const found = findTask(data, taskId);
  if (found) found.group.tasks.splice(found.index, 1);
}

/** Removes the finished tasks of one group. */
export function clearDone(data: TodoList, groupId: string): void {
  const group = data.groups.find((item) => item.id === groupId);
  if (group) group.tasks = group.tasks.filter((task) => !task.done);
}

/**
 * Moves a task to a position in a group, counted as if the task were already
 * removed from where it is. Used by drag and drop and by Move up/down.
 */
export function moveTask(data: TodoList, taskId: string, groupId: string, index: number): void {
  const found = findTask(data, taskId);
  const target = data.groups.find((group) => group.id === groupId);
  if (!found || !target) return;
  found.group.tasks.splice(found.index, 1);
  target.tasks.splice(clamp(index, 0, target.tasks.length), 0, found.task);
}

/** Moves a task one place up (-1) or down (+1) inside its group. */
export function shiftTask(data: TodoList, taskId: string, delta: number): void {
  const found = findTask(data, taskId);
  if (found) moveTask(data, taskId, found.group.id, found.index + delta);
}

// ── Steps (subtasks) ─────────────────────────────────────────────────

export function addStep(data: TodoList, taskId: string, stepId: string, title: string): void {
  const task = findTask(data, taskId)?.task;
  const clean = title.trim().slice(0, MAX.title);
  if (!task || !clean || task.steps.some((step) => step.id === stepId)) return;
  task.steps.push({ id: stepId, title: clean, done: false });
}

export function updateStep(data: TodoList, taskId: string, stepId: string, patch: Partial<Pick<Step, "title" | "done">>): void {
  const step = findTask(data, taskId)?.task.steps.find((item) => item.id === stepId);
  if (!step) return;
  if (patch.title !== undefined) {
    const title = patch.title.trim().slice(0, MAX.title);
    if (title) step.title = title;
  }
  if (patch.done !== undefined) step.done = patch.done;
}

export function deleteStep(data: TodoList, taskId: string, stepId: string): void {
  const task = findTask(data, taskId)?.task;
  if (task) task.steps = task.steps.filter((step) => step.id !== stepId);
}

/** Only web addresses are kept as links. */
export function normalizeLink(input: string): string | null {
  const value = input.trim();
  if (!value) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
