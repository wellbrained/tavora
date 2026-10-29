<script setup lang="ts">
// One group of to-dos with its own add row. Tasks can be dragged inside and
// between groups; the menus offer the same moves without a mouse. The group's
// menu (⋯ or a right-click on the header) is drawn by Tavora above every
// panel, so its Color submenu is never cut off in a narrow panel.
import type { MenuEntry } from "@tavora/sdk";
import { ChevronRight, Ellipsis } from "@lucide/vue";
import { cn } from "@tavora/official-ui";
import { computed, inject, nextTick, onBeforeUnmount, ref } from "vue";
import AddInput from "./AddInput.vue";
import { plural, t } from "./i18n";
import { collapse, PANEL } from "./panel";
import type { TodoStore } from "./store";
import TaskRow from "./TaskRow.vue";
import {
  addTask,
  indexAfter,
  insertTask,
  levelsAt,
  clearDone,
  depths,
  GROUP_COLORS,
  GROUP_TINTS,
  MAX,
  MAX_DEPTH,
  moveGroup,
  openCount,
  parentAtEnd,
  renameGroup,
  setGroupColor,
  type Group,
  type GroupColor,
  type Task,
} from "./todos";

export interface DropTarget {
  groupId: string;
  /** The task the dragged one lands in front of, as its sibling; null for the end of the group. */
  beforeId: string | null;
}

const props = defineProps<{
  store: TodoStore;
  group: Group;
  groups: Group[];
  position: number;
  collapsed: boolean;
  dragging: boolean;
  drop: DropTarget | null;
}>();
const emit = defineEmits<{
  toggleCollapsed: [];
  remove: [];
  dragstart: [taskId: string, event: DragEvent];
  dragend: [];
  dragover: [target: DropTarget];
  drop: [];
}>();
const panel = inject(PANEL)!;

/** "None" first, then each color. */
const COLOR_OPTIONS: GroupColor[] = ["", ...GROUP_COLORS];
const colorName = (color: GroupColor) => (color ? t(`color.${color}`) : t("group.color.none"));

const renaming = ref(false);
const nameInput = ref<HTMLInputElement | null>(null);
const remaining = computed(() => openCount(props.group));
const doneCount = computed(() => props.group.tasks.length - remaining.value);
const change = (fn: Parameters<TodoStore["apply"]>[0]) => void props.store.apply(fn);

interface Row {
  task: Task;
  index: number;
  depth: number;
  children: { done: number; total: number };
}

/**
 * The rows this panel shows: sub-to-dos of folded or hidden tasks are left
 * out, and so are finished ones when they vanish, unless they (or a task
 * above them) were finished a moment ago.
 */
const rows = computed<Row[]>(() => {
  const { tasks } = props.group;
  const depth = depths(tasks);
  const children = new Map<string, { done: number; total: number }>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    const count = children.get(task.parentId) ?? { done: 0, total: 0 };
    count.total++;
    if (task.done) count.done++;
    children.set(task.parentId, count);
  }
  const vanish = panel.finished.value === "vanish";
  const hidden = new Set<string>();
  const kept = new Set<string>();
  const shown: Row[] = [];
  tasks.forEach((task, index) => {
    const parent = task.parentId;
    if (parent && (hidden.has(parent) || panel.folded.value.includes(parent))) return hidden.add(task.id);
    if (panel.lingering.value.has(task.id) || (parent && kept.has(parent))) kept.add(task.id);
    if (vanish && task.done && !kept.has(task.id)) return hidden.add(task.id);
    shown.push({ task, index, depth: depth.get(task.id) ?? 0, children: children.get(task.id) ?? { done: 0, total: 0 } });
  });
  return shown;
});

// The add row indents with Tab like a to-do being edited: one level deeper than the last to-do at most.
const addLevel = ref(0);
const maxAddLevel = computed(() => {
  const last = props.group.tasks.at(-1);
  return last ? Math.min((depths(props.group.tasks).get(last.id) ?? 0) + 1, MAX_DEPTH) : 0;
});

async function startRename() {
  renaming.value = true;
  await nextTick();
  nameInput.value?.select();
}

function finishRename(event: Event) {
  if (!renaming.value) return;
  renaming.value = false;
  const name = (event.target as HTMLInputElement).value;
  if (name.trim() && name.trim() !== props.group.name) change((data) => renameGroup(data, props.group.id, name));
}

// The whole header row collapses and expands the group. On the name a
// double-click renames instead, so a single click there waits briefly to see
// whether a second one follows.
const DOUBLE_CLICK_MS = 250;
let clickTimer: ReturnType<typeof setTimeout> | undefined;

function onHeaderClick(event: MouseEvent) {
  if (renaming.value || (event.target as Element).closest("button, input, [role=menu]")) return;
  if (!(event.target as Element).closest("[data-testid=group-name]")) return emit("toggleCollapsed");
  clearTimeout(clickTimer);
  if (event.detail > 1) return;
  clickTimer = setTimeout(() => emit("toggleCollapsed"), DOUBLE_CLICK_MS);
}

onBeforeUnmount(() => clearTimeout(clickTimer));

function onNameDoubleClick() {
  clearTimeout(clickTimer);
  void startRename();
}

/** The group's menu, as entries Tavora draws. */
function menuEntries(): MenuEntry[] {
  return [
    { type: "item", id: "rename", label: t("group.rename") },
    { type: "item", id: "up", label: t("group.moveUp"), disabled: props.position === 0 },
    { type: "item", id: "down", label: t("group.moveDown"), disabled: props.position === props.groups.length - 1 },
    {
      type: "submenu",
      label: t("group.color"),
      items: COLOR_OPTIONS.map((option) => ({
        type: "item" as const,
        id: `color:${option || "none"}`,
        label: colorName(option),
        color: option ? GROUP_TINTS[option] : "transparent",
        checked: props.group.color === option,
        radio: true,
      })),
    },
    { type: "item", id: "clear-done", label: t("group.deleteFinished"), disabled: !doneCount.value },
    { type: "separator" },
    { type: "item", id: "delete", label: t("group.delete"), danger: true },
  ];
}

/** The ⋯ button's menu opens below it; a right-click on the header opens it at the pointer. */
const menuOpen = ref(false);
async function openMenu(at: { x: number; y: number; width?: number; height?: number }) {
  menuOpen.value = true;
  const choice = await panel.showMenu({ items: menuEntries(), at, align: at.width ? "end" : "start" }).catch(() => null);
  menuOpen.value = false;
  if (choice === "rename") void startRename();
  else if (choice === "up") change((data) => moveGroup(data, props.group.id, -1));
  else if (choice === "down") change((data) => moveGroup(data, props.group.id, 1));
  else if (choice === "clear-done") change((data) => clearDone(data, props.group.id));
  else if (choice === "delete") emit("remove");
  else if (choice?.startsWith("color:")) {
    const option = choice.slice("color:".length);
    const color = COLOR_OPTIONS.find((item) => (item || "none") === option);
    if (color !== undefined) change((data) => setGroupColor(data, props.group.id, color));
  }
}
function onMenuButton(event: MouseEvent) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  void openMenu({ x: box.left, y: box.top, width: box.width, height: box.height });
}
function onHeaderContextMenu(event: MouseEvent) {
  if (renaming.value || (event.target as Element).closest("input")) return;
  event.preventDefault();
  void openMenu({ x: event.clientX, y: event.clientY });
}

// ── A new to-do typed between others (Enter in a title, or Add below) ──

/** Where the draft sits in the group's tasks, and which levels it can take there. */
const draft = computed(() => {
  const open = panel.draft.value;
  if (!open || open.groupId !== props.group.id || props.collapsed) return null;
  const index = indexAfter(props.group.tasks, open.afterId);
  return { index, ...levelsAt(props.group.tasks, index) };
});

/** The rows with the draft among them: in front of the first row shown that comes after it. */
const entries = computed(() => {
  const list: ({ row: Row; at: number } | { draft: true })[] = rows.value.map((row, at) => ({ row, at }));
  if (!draft.value) return list;
  const before = rows.value.findIndex((row) => row.index >= draft.value!.index);
  list.splice(before === -1 ? list.length : before, 0, { draft: true });
  return list;
});

const draftLevel = computed({
  get: () => panel.draft.value?.level ?? 0,
  set: (level: number) => panel.draft.value && (panel.draft.value = { ...panel.draft.value, level }),
});

function addDraft(text: string, level: number) {
  const open = panel.draft.value;
  if (!open) return;
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const { groupId, afterId } = open;
  change((data) => insertTask(data, groupId, afterId, level, { id, title: text, createdAt }));
  // The next one follows the new one, at the same level.
  panel.draft.value = { groupId, afterId: id, level };
}

function closeDraft() {
  if (panel.draft.value?.groupId === props.group.id) panel.draft.value = null;
}

function add(text: string, level: number) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const parentId = parentAtEnd(props.group, level);
  const newGroupId = crypto.randomUUID();
  change((data) => addTask(data, props.group.id, { id, title: text, createdAt, parentId }, newGroupId));
}

/** Dropping on a row's lower half puts the task in front of the next row shown, or at the end. */
function overTask(event: DragEvent, position: number) {
  if (!props.dragging) return;
  event.preventDefault();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;
  emit("dragover", { groupId: props.group.id, beforeId: rows.value[after ? position + 1 : position]?.task.id ?? null });
}

function overGroup(event: DragEvent) {
  if (!props.dragging) return;
  event.preventDefault();
  if (event.target === event.currentTarget || props.collapsed) emit("dragover", { groupId: props.group.id, beforeId: null });
}

function dropMark(position: number): "before" | "after" | null {
  if (!props.drop || props.drop.groupId !== props.group.id) return null;
  if (props.drop.beforeId === rows.value[position]!.task.id) return "before";
  if (props.drop.beforeId === null && position === rows.value.length - 1) return "after";
  return null;
}
</script>

<template>
  <section
    :class="
      cn(
        'bg-card overflow-hidden rounded-lg border',
        drop?.groupId === group.id && (collapsed || !rows.length) && 'border-primary bg-primary/10',
      )
    "
    :aria-label="group.name"
    :data-testid="`group-${group.id}`"
    @dragover="overGroup"
    @drop.prevent="emit('drop')"
  >
    <header
      :class="
        cn(
          'group/header relative flex h-10 cursor-pointer items-center gap-1 pr-1 pl-1.5 select-none',
          group.color ? 'tinted-header' : 'hover:bg-accent/40',
          !collapsed && 'border-b',
        )
      "
      :data-tint="group.color || undefined"
      :style="group.color ? { '--tint': GROUP_TINTS[group.color] } : undefined"
      data-testid="group-header"
      @click="onHeaderClick"
      @contextmenu="onHeaderContextMenu"
    >
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground flex size-6 flex-none items-center justify-center rounded-md"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? t('group.show', { name: group.name }) : t('group.hide', { name: group.name })"
        data-testid="group-collapse"
        @click="emit('toggleCollapsed')"
      >
        <ChevronRight :class="cn('size-4 transition-transform', !collapsed && 'rotate-90')" :stroke-width="1.5" />
      </button>
      <input
        v-if="renaming"
        ref="nameInput"
        :value="group.name"
        :maxlength="MAX.groupName"
        :aria-label="t('group.name')"
        data-testid="group-name-input"
        class="focus-visible:border-ring h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-sm font-semibold outline-none"
        @blur="finishRename"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
        @keydown.escape="renaming = false"
      />
      <div v-else class="min-w-0 flex-1">
        <h2 class="max-w-full truncate px-1 text-sm font-semibold" style="width: fit-content" :title="t('group.renameHint')" data-testid="group-name" @dblclick="onNameDoubleClick">
          {{ group.name }}
        </h2>
      </div>
      <span
        v-if="group.tasks.length"
        :class="cn('flex-none rounded-full px-2 py-0.5 text-xs tabular-nums', remaining ? 'bg-background text-muted-foreground' : 'bg-primary/15 text-primary')"
        data-testid="group-count"
      >
        {{ remaining ? t("group.left", { count: remaining }) : t("group.allDone") }}
      </span>
      <!-- How much of the group is done, as a thin line along the header's bottom edge. -->
      <span
        v-if="group.tasks.length && !collapsed"
        class="absolute bottom-[-1px] left-0 h-px bg-[var(--tint,var(--primary))] transition-[width] duration-300 motion-reduce:transition-none"
        :style="{ width: `${(doneCount / group.tasks.length) * 100}%` }"
        aria-hidden="true"
      />
      <button
        type="button"
        :class="cn('text-muted-foreground hover:text-foreground flex size-7 flex-none items-center justify-center rounded-md opacity-40 group-hover/header:opacity-100 focus-visible:opacity-100', menuOpen && 'opacity-100')"
        :aria-label="t('moreFor', { name: group.name })"
        :title="t('more')"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        data-testid="group-menu"
        @click="onMenuButton"
      >
        <Ellipsis class="size-4" :stroke-width="1.5" />
      </button>
    </header>

    <div v-if="!collapsed" class="p-1">
      <TransitionGroup tag="ul" role="list" :css="false" @leave="collapse">
        <li v-for="entry in entries" :key="'draft' in entry ? 'draft' : entry.row.task.id" @dragover="'draft' in entry || overTask($event, entry.at)">
          <AddInput
            v-if="'draft' in entry"
            v-model:level="draftLevel"
            draft
            align-to-tasks
            :min-level="draft!.min"
            :max-level="draft!.max"
            :placeholder="Math.max(Math.min(draftLevel, draft!.max), draft!.min) ? t('group.addSub') : t('app.addTodo')"
            :title="draft!.max > draft!.min ? t('group.addHint') : undefined"
            :maxlength="MAX.title"
            data-testid="draft-task"
            @add="addDraft"
            @close="closeDraft"
          />
          <TaskRow
            v-else
            :store="store"
            :task="entry.row.task"
            :group="group"
            :groups="groups"
            :index="entry.row.index"
            :depth="entry.row.depth"
            :children="entry.row.children"
            :drop="dropMark(entry.at)"
            @dragstart="(event) => emit('dragstart', entry.row.task.id, event)"
            @dragend="emit('dragend')"
          />
        </li>
      </TransitionGroup>
      <p v-if="panel.finished.value === 'vanish' && doneCount && !rows.length" class="text-muted-foreground px-3 py-1 text-xs">
        {{ plural("group.hidden", doneCount) }}
      </p>
      <AddInput
        v-model:level="addLevel"
        align-to-tasks
        :max-level="maxAddLevel"
        :placeholder="Math.min(addLevel, maxAddLevel) ? t('group.addSub') : t('group.addTo', { name: group.name })"
        :title="maxAddLevel ? t('group.addHint') : undefined"
        :maxlength="MAX.title"
        :data-testid="`add-task-${group.id}`"
        @add="add"
      />
    </div>
  </section>
</template>
