// The data side of To-Dos: one document per workspace holds every group and
// task, and each change is a pure function on it. Changes take their new ids
// as arguments, so re-applying one after another panel saved first gives the
// same result.
//
// Sub-to-dos are ordinary tasks with a `parentId`. A group keeps its tasks
// in one flat list in the order they are shown, so a task's sub-to-dos
// always follow it directly: a task and everything below it form a block
// that moves as one.

import type { JsonValue } from "@tavora/sdk";

/** The document every To-Dos panel of a workspace shares. */
export const LIST_ID = "todos";
export const LIST_TITLE = "To-Dos";
/** The group a first to-do goes into when there is none yet. */
export const DEFAULT_GROUP = "To-Dos";

export const MAX = { groupName: 80, title: 300, details: 5000 } as const;
/** What a stored list may hold; a damaged or hand-edited document cannot make the panel build more than this. */
export const LIMITS = { groups: 200, tasksPerGroup: 2000 } as const;
/** How deep sub-to-dos go: a top-level task is depth 0, so there are four levels in all. */
export const MAX_DEPTH = 3;

export interface Task {
  [key: string]: JsonValue;
  id: string;
  title: string;
  done: boolean;
  /** Optional longer text. */
  details: string;
  /** Pinned tasks are shown as current objectives at the top. */
  pinned: boolean;
  /** The task this one is a sub-to-do of, in the same group; null at the top level. */
  parentId: string | null;
  createdAt: string;
  doneAt: string | null;
}

/** The colors a group header can be tinted with. Empty means none. */
export const GROUP_COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "violet", "pink"] as const;
export type GroupColor = (typeof GROUP_COLORS)[number] | "";

/** Each color as a CSS color: the header's tint, and the dot in the Color menu Tavora draws. */
export const GROUP_TINTS: Readonly<Record<Exclude<GroupColor, "">, string>> = {
  red: "oklch(0.64 0.2 25)",
  orange: "oklch(0.72 0.17 55)",
  yellow: "oklch(0.82 0.16 95)",
  green: "oklch(0.7 0.17 150)",
  teal: "oklch(0.7 0.12 195)",
  blue: "oklch(0.65 0.17 255)",
  violet: "oklch(0.63 0.2 295)",
  pink: "oklch(0.7 0.19 350)",
};

export interface Group {
  [key: string]: JsonValue;
  id: string;
  name: string;
  /** Tints the group's header; "" for none. */
  color: GroupColor;
  tasks: Task[];
}

export interface TodoList {
  [key: string]: JsonValue;
  version: 2;
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

/** Turns stored data, or null for a new workspace, into a valid list. */
export function parseList(raw: JsonValue | null): TodoList {
  const groups = isObject(raw ?? null) ? list((raw as JsonObject).groups) : [];
  return {
    version: 2,
    groups: unique(
      groups.slice(0, LIMITS.groups).map((group) => ({
        id: text(group.id, 64),
        name: text(group.name, MAX.groupName) || DEFAULT_GROUP,
        color: parseColor(group.color),
        tasks: tidy(unique(list(group.tasks).flatMap(parseTask)).slice(0, LIMITS.tasksPerGroup)),
      })),
    ),
  };
}

/** A known color name, or "" for none and for anything an older version or a hand edit left there. */
function parseColor(value: JsonValue | undefined): GroupColor {
  return GROUP_COLORS.find((color) => color === value) ?? "";
}

/**
 * One stored task, followed by the sub-to-dos an older version kept as
 * "steps". That version's source link moves into the details so nothing
 * written there is lost.
 */
function parseTask(task: JsonObject): Task[] {
  const id = text(task.id, 64);
  const done = task.done === true;
  const createdAt = text(task.createdAt, 40);
  const link = text(task.link, 2000).trim();
  const details = text(task.details, MAX.details);
  const steps = list(task.steps)
    .slice(0, 200)
    .map((step): Task => {
      const stepDone = step.done === true;
      return {
        id: text(step.id, 64),
        title: text(step.title, MAX.title),
        done: stepDone,
        details: "",
        pinned: false,
        parentId: id,
        createdAt,
        doneAt: stepDone ? createdAt : null,
      };
    });
  return [
    {
      id,
      title: text(task.title, MAX.title),
      done,
      details: (link && !details.includes(link) ? (details ? `${details}\n${link}` : link) : details).slice(0, MAX.details),
      pinned: task.pinned === true,
      parentId: typeof task.parentId === "string" ? task.parentId : null,
      createdAt,
      doneAt: done && typeof task.doneAt === "string" ? task.doneAt.slice(0, 40) : null,
    },
    ...steps,
  ];
}

/**
 * Makes every parent point at a task above it whose block the task is in,
 * and keeps nesting within MAX_DEPTH. Anything else moves up to the deepest
 * level it can keep.
 */
function tidy(tasks: Task[]): Task[] {
  let chain: string[] = [];
  for (const task of tasks) {
    const level = Math.min(task.parentId ? chain.indexOf(task.parentId) + 1 : 0, MAX_DEPTH);
    task.parentId = level ? chain[level - 1]! : null;
    chain = [...chain.slice(0, level), task.id];
  }
  return tasks;
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

/** Open tasks of a group, sub-to-dos included. */
export function openCount(group: Group): number {
  return group.tasks.filter((task) => !task.done).length;
}

/** How deep each task of a group sits, by id. */
export function depths(tasks: Task[]): Map<string, number> {
  const depth = new Map<string, number>();
  for (const task of tasks) depth.set(task.id, task.parentId ? (depth.get(task.parentId) ?? -1) + 1 : 0);
  return depth;
}

/** Where the block of the task at `index` ends: the index right after its last sub-to-do. */
export function blockEnd(tasks: Task[], index: number): number {
  const inside = new Set([tasks[index]!.id]);
  let end = index + 1;
  while (end < tasks.length && inside.has(tasks[end]!.parentId!)) inside.add(tasks[end++]!.id);
  return end;
}

/** The ids of a task's sub-to-dos at any depth. */
function descendants(tasks: Task[], index: number): Task[] {
  return tasks.slice(index + 1, blockEnd(tasks, index));
}

/** The nearest task above with the same parent, or -1. */
function previousSibling(tasks: Task[], index: number): number {
  const { parentId } = tasks[index]!;
  for (let at = index - 1; at >= 0; at--) {
    if (tasks[at]!.id === parentId) return -1;
    if (tasks[at]!.parentId === parentId) return at;
  }
  return -1;
}

/** How many levels a block spans below its top task. */
function blockHeight(tasks: Task[], index: number): number {
  const depth = depths(tasks.slice(index, blockEnd(tasks, index)).map((task, at) => (at ? task : { ...task, parentId: null })));
  return Math.max(...depth.values());
}

/** The sub-to-dos directly under a task: how many there are and how many are done. */
export function childCount(tasks: Task[], taskId: string): { done: number; total: number } {
  const children = tasks.filter((task) => task.parentId === taskId);
  return { done: children.filter((task) => task.done).length, total: children.length };
}

/**
 * The levels a task added at `index` can take: at least the level of the
 * task now there, which must keep its parent, and at most one deeper than
 * the task above, within MAX_DEPTH.
 */
export function levelsAt(tasks: Task[], index: number): { min: number; max: number } {
  const depth = depths(tasks);
  const above = tasks[index - 1];
  const below = tasks[index];
  const max = above ? Math.min(depth.get(above.id)! + 1, MAX_DEPTH) : 0;
  return { min: below ? Math.min(depth.get(below.id)!, max) : 0, max };
}

/**
 * The parent a task added at `index` gets at `level`: the task above, or
 * its ancestor, one level up. The level is pulled into what `levelsAt` allows.
 */
export function parentAt(tasks: Task[], index: number, level: number): string | null {
  const { min, max } = levelsAt(tasks, index);
  const chain: string[] = [];
  for (let id = tasks[index - 1]?.id ?? null; id; id = tasks.find((task) => task.id === id)?.parentId ?? null) chain.unshift(id);
  const clamped = clamp(level, min, max);
  return clamped ? chain[clamped - 1]! : null;
}

/** The parent a task added at the end of a group gets when it is indented to `level`. */
export function parentAtEnd(group: Group, level: number): string | null {
  return parentAt(group.tasks, group.tasks.length, level);
}

/** Where a task added after `afterId` goes: right after its sub-to-dos; at the end of the group when it is gone or null. */
export function indexAfter(tasks: Task[], afterId: string | null): number {
  const at = tasks.findIndex((task) => task.id === afterId);
  return at === -1 ? tasks.length : blockEnd(tasks, at);
}

// ── Changes ──────────────────────────────────────────────────────────
// Each one changes `data` in place and quietly does nothing when its target
// was removed by another panel in the meantime.

export function addGroup(data: TodoList, id: string, name: string, index = data.groups.length): void {
  const clean = name.trim().slice(0, MAX.groupName);
  if (!clean || data.groups.some((group) => group.id === id)) return;
  data.groups.splice(clamp(index, 0, data.groups.length), 0, { id, name: clean, color: "", tasks: [] });
}

/** Tints a group's header; anything that is not one of GROUP_COLORS takes the tint away. */
export function setGroupColor(data: TodoList, groupId: string, color: string): void {
  const group = data.groups.find((item) => item.id === groupId);
  if (group) group.color = GROUP_COLORS.find((known) => known === color) ?? "";
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
  /** Adds it as the last sub-to-do of this task; at the end of the group when null or gone. */
  parentId?: string | null;
}

/**
 * Adds a task at the end of a group, or of its parent's sub-to-dos. With no
 * group id, or when that group is gone, it goes into the first group, which
 * is created if there is none.
 */
export function addTask(data: TodoList, groupId: string | null, task: NewTask, newGroupId: string): void {
  const title = task.title.trim().slice(0, MAX.title);
  if (!title || findTask(data, task.id)) return;
  let group = data.groups.find((item) => item.id === groupId) ?? data.groups[0];
  if (!group) {
    addGroup(data, newGroupId, DEFAULT_GROUP);
    group = data.groups[0]!;
  }
  const parent = group.tasks.findIndex((item) => item.id === task.parentId);
  const at = parent === -1 ? group.tasks.length : blockEnd(group.tasks, parent);
  group.tasks.splice(at, 0, {
    id: task.id,
    title,
    done: false,
    details: "",
    pinned: false,
    parentId: parent === -1 ? null : task.parentId!,
    createdAt: task.createdAt,
    doneAt: null,
  });
  tidy(group.tasks);
}

/**
 * Adds a task right after another one and its sub-to-dos, at `level`
 * (pulled into what fits there). Does nothing when the group is gone; when
 * the task it follows is gone, it goes to the end of the group.
 */
export function insertTask(data: TodoList, groupId: string, afterId: string | null, level: number, task: Omit<NewTask, "parentId">): void {
  const title = task.title.trim().slice(0, MAX.title);
  const group = data.groups.find((item) => item.id === groupId);
  if (!title || !group || findTask(data, task.id)) return;
  const at = indexAfter(group.tasks, afterId);
  group.tasks.splice(at, 0, {
    id: task.id,
    title,
    done: false,
    details: "",
    pinned: false,
    parentId: parentAt(group.tasks, at, level),
    createdAt: task.createdAt,
    doneAt: null,
  });
  tidy(group.tasks);
}

export type TaskPatch =Partial<Pick<Task, "title" | "details" | "pinned">>;

export function updateTask(data: TodoList, taskId: string, patch: TaskPatch): void {
  const found = findTask(data, taskId);
  if (!found) return;
  const { task } = found;
  if (patch.title !== undefined) {
    const title = patch.title.trim().slice(0, MAX.title);
    if (title) task.title = title;
  }
  if (patch.details !== undefined) task.details = patch.details.slice(0, MAX.details);
  if (patch.pinned !== undefined) task.pinned = patch.pinned;
}

/**
 * Finishing a task finishes its sub-to-dos too; reopening one reopens the
 * tasks it sits under. A finished objective is no longer current.
 */
export function setDone(data: TodoList, taskId: string, done: boolean, at: string): void {
  const found = findTask(data, taskId);
  if (!found) return;
  const { group, task, index } = found;
  const affected = done ? [task, ...descendants(group.tasks, index)] : [task, ...ancestors(group, task)];
  for (const item of affected) {
    if (item.done === done) continue;
    item.done = done;
    item.doneAt = done ? at : null;
    if (done) item.pinned = false;
  }
}

function ancestors(group: Group, task: Task): Task[] {
  const found: Task[] = [];
  for (let parent = task.parentId; parent; ) {
    const item = group.tasks.find((candidate) => candidate.id === parent);
    if (!item) break;
    found.push(item);
    parent = item.parentId;
  }
  return found;
}

/** What finishing or reopening a task can change, saved so it can be put back. */
export type DoneState = Pick<Task, "id" | "done" | "doneAt" | "pinned">[];

export function doneState(data: TodoList, taskId: string): DoneState {
  const found = findTask(data, taskId);
  if (!found) return [];
  const { group, task, index } = found;
  return [task, ...descendants(group.tasks, index), ...ancestors(group, task)].map(({ id, done, doneAt, pinned }) => ({ id, done, doneAt, pinned }));
}

export function restoreDone(data: TodoList, state: DoneState): void {
  for (const saved of state) {
    const task = findTask(data, saved.id)?.task;
    if (task) Object.assign(task, saved);
  }
}

/** Deletes a task with its sub-to-dos. */
export function deleteTask(data: TodoList, taskId: string): void {
  const found = findTask(data, taskId);
  if (found) found.group.tasks.splice(found.index, blockEnd(found.group.tasks, found.index) - found.index);
}

/** A task with its sub-to-dos and where they were, so a deletion can be undone. */
export interface Removed {
  groupId: string;
  index: number;
  tasks: Task[];
}

export function removedBlock(data: TodoList, taskId: string): Removed | null {
  const found = findTask(data, taskId);
  if (!found) return null;
  return { groupId: found.group.id, index: found.index, tasks: structuredClone(found.group.tasks.slice(found.index, blockEnd(found.group.tasks, found.index))) };
}

/** Puts a deleted block back where it was, unless its group is gone or its tasks came back some other way. */
export function restoreBlock(data: TodoList, removed: Removed): void {
  const group = data.groups.find((item) => item.id === removed.groupId);
  if (!group || removed.tasks.some((task) => findTask(data, task.id))) return;
  group.tasks.splice(clamp(removed.index, 0, group.tasks.length), 0, ...structuredClone(removed.tasks));
  tidy(group.tasks);
}

/** Removes the finished tasks of one group, with their sub-to-dos. */
export function clearDone(data: TodoList, groupId: string): void {
  const group = data.groups.find((item) => item.id === groupId);
  if (!group) return;
  const gone = new Set<string>();
  group.tasks = group.tasks.filter((task) => {
    if (task.done || gone.has(task.parentId!)) gone.add(task.id);
    return !gone.has(task.id);
  });
}

/**
 * Moves a task with its sub-to-dos in front of another task, becoming that
 * task's sibling, or to the end of a group's top level when `beforeId` is
 * null. Used by drag and drop and by Move to group.
 */
export function moveTask(data: TodoList, taskId: string, groupId: string, beforeId: string | null): void {
  const found = findTask(data, taskId);
  const target = data.groups.find((group) => group.id === groupId);
  if (!found || !target) return;
  const block = found.group.tasks.slice(found.index, blockEnd(found.group.tasks, found.index));
  if (beforeId !== null && block.some((task) => task.id === beforeId)) return;
  const before = beforeId === null ? null : target.tasks.find((task) => task.id === beforeId);
  if (before === undefined) return;
  found.group.tasks.splice(found.index, block.length);
  block[0]!.parentId = before?.parentId ?? null;
  target.tasks.splice(before ? target.tasks.indexOf(before) : target.tasks.length, 0, ...block);
  tidy(target.tasks);
}

/** Moves a task, with its sub-to-dos, past its sibling above (-1) or below (+1). */
export function shiftTask(data: TodoList, taskId: string, delta: -1 | 1): void {
  const found = findTask(data, taskId);
  if (!found) return;
  const { tasks } = found.group;
  const end = blockEnd(tasks, found.index);
  if (delta === -1) {
    const above = previousSibling(tasks, found.index);
    if (above !== -1) tasks.splice(above, 0, ...tasks.splice(found.index, end - found.index));
  } else if (tasks[end]?.parentId === found.task.parentId && end < tasks.length) {
    const block = tasks.splice(found.index, end - found.index);
    tasks.splice(blockEnd(tasks, found.index), 0, ...block);
  }
}

/** Whether a task can be moved up (-1) or down (+1) among its siblings. */
export function canShift(group: Group, index: number, delta: -1 | 1): boolean {
  if (delta === -1) return previousSibling(group.tasks, index) !== -1;
  return group.tasks[blockEnd(group.tasks, index)]?.parentId === group.tasks[index]!.parentId && blockEnd(group.tasks, index) < group.tasks.length;
}

/** Makes a task the last sub-to-do of its sibling above, if nesting allows. */
export function indentTask(data: TodoList, taskId: string): void {
  const found = findTask(data, taskId);
  if (!found || !canIndent(found.group, found.index)) return;
  found.task.parentId = found.group.tasks[previousSibling(found.group.tasks, found.index)]!.id;
}

export function canIndent(group: Group, index: number): boolean {
  const above = previousSibling(group.tasks, index);
  if (above === -1) return false;
  return depths(group.tasks).get(group.tasks[above]!.id)! + 1 + blockHeight(group.tasks, index) <= MAX_DEPTH;
}

/**
 * Moves a task one level up: it follows its former parent's block, and the
 * tasks below it stay where they are.
 */
export function outdentTask(data: TodoList, taskId: string): void {
  const found = findTask(data, taskId);
  if (!found || !found.task.parentId) return;
  const { tasks } = found.group;
  const parent = tasks.findIndex((task) => task.id === found.task.parentId);
  const parentEnd = blockEnd(tasks, parent);
  const block = tasks.splice(found.index, blockEnd(tasks, found.index) - found.index);
  block[0]!.parentId = tasks[parent]!.parentId;
  tasks.splice(parentEnd - block.length, 0, ...block);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
