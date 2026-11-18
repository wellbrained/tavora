<script setup lang="ts">
// The list over the game while the in-game layer is open. The overlay page shows the live view read-only while the
// layer is closed; when it opens, Tavora lends this panel to the layer in the same spot, and the panel draws the very
// same plate (plate.ts, plate.css: same rows, look and box), now editable: the box ticks a to-do, a double-click on
// the title renames it, ⋯ has the row's menu, and the last line adds a to-do. Groups, Keep finished and the settings
// stay in the full panel in Tavora. Rows that don't fit scroll inside the plate instead of being cut.
import { Ellipsis } from "@lucide/vue";
import { useFocusRecovery } from "@tavora/official-ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { Textarea } from "@tavora/official-ui/components/ui/textarea";
import { computed, inject, nextTick, provide, ref } from "vue";
import AddInput from "./AddInput.vue";
import { t } from "./i18n";
import { buildPlateRows, type LiveLook, type PlateGroupRow, type PlateTaskRow } from "./live";
import { PANEL, ROW_FOCUS } from "./panel";
import { plateStyle } from "./plate";
import { afterMenu, rowChange, rowMenu, taskActions, type RowAction } from "./row";
import RowMenuItems from "./RowMenuItems.vue";
import type { TodoStore } from "./store";
import { addTask, findTask, insertTask, MAX, type Group, type Task, type TodoList } from "./todos";

const props = defineProps<{ store: TodoStore; list: TodoList; collapsed: readonly string[]; look: LiveLook }>();
const panel = inject(PANEL)!;

const plateEl = ref<HTMLElement | null>(null);
// A finished or deleted to-do hands the focus to the next row; Undo gives it back.
const rowFocus = useFocusRecovery(plateEl);
provide(ROW_FOCUS, rowFocus);
const actions = taskActions(props.store, panel, rowFocus);
const menuFocus = afterMenu();

/** How opaque the plate is at least while it can be edited, in percent: the controls on it have to read. */
const EDIT_BACKGROUND = 50;
const style = computed(() => plateStyle({ ...props.look, background: Math.max(props.look.background, EDIT_BACKGROUND) }));

type Entry =
  | { kind: "group"; key: string; row: PlateGroupRow }
  | { kind: "task"; key: string; row: PlateTaskRow; task: Task; group: Group; index: number }
  | { kind: "draft"; key: string; depth: number };

/** The live view's rows, all of them, with the to-do each shows; a new to-do being typed sits among them. */
const entries = computed<Entry[]>(() => {
  const rows = buildPlateRows(props.list, props.collapsed, props.look, { objectives: t("app.objectives") }, panel.lingering.value);
  const shown: Entry[] = [];
  for (const row of rows) {
    if (row.kind === "group") shown.push({ kind: "group", key: `group:${row.groupId ?? ""}`, row });
    else {
      const found = findTask(props.list, row.taskId);
      if (found) shown.push({ kind: "task", key: `task:${row.taskId}`, row, ...found });
    }
  }
  const draft = panel.draft.value;
  if (draft) shown.splice(draftAt(shown, draft.groupId, draft.afterId), 0, { kind: "draft", key: "draft", depth: draft.level });
  return shown;
});

/** Where a new to-do typed after `afterId` shows: after that row and the rows under it, else at the end of its group. */
function draftAt(shown: Entry[], groupId: string, afterId: string): number {
  /** The depth of a row of the group's own part (not an objective), or null for any other entry. */
  const depthIn = (entry: Entry | undefined) => (entry?.kind === "task" && entry.group.id === groupId && !entry.row.pinned ? entry.row.depth : null);
  const at = shown.findIndex((entry) => depthIn(entry) !== null && entry.kind === "task" && entry.task.id === afterId);
  if (at === -1) {
    let end = shown.length;
    while (end > 0 && depthIn(shown[end - 1]) === null) end--;
    return end === 0 ? shown.length : end;
  }
  const depth = depthIn(shown[at])!;
  let end = at + 1;
  while ((depthIn(shown[end]) ?? -1) > depth) end++;
  return end;
}

const indent = (depth: number) => (depth ? { paddingLeft: `${depth * 1.2}em` } : undefined);

// ── Renaming in place ────────────────────────────────────────────────

/** The editor's key in the panel's `editing`, apart from the panel's own rows. */
const editKey = (taskId: string) => `plate:${taskId}`;
const title = ref("");

/** The row's own control (its box) or editor, found inside this plate. */
function inRow(taskId: string, selector: string): HTMLElement | null {
  const row = [...(plateEl.value?.querySelectorAll<HTMLElement>("[data-focus-row]") ?? [])].find((item) => item.dataset.focusRow === taskId);
  return row?.querySelector<HTMLElement>(selector) ?? null;
}

async function startRename(task: Task) {
  title.value = task.title;
  panel.draft.value = null;
  panel.editing.value = editKey(task.id);
  await nextTick();
  const input = inRow(task.id, "textarea") as HTMLTextAreaElement | null;
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
}

/** Saves (or not) and closes the editor; with `refocus`, the row's box takes the focus back. */
async function finishRename(task: Task, keep: boolean, refocus = false) {
  if (panel.editing.value !== editKey(task.id)) return;
  if (keep) actions.rename(task, title.value);
  panel.editing.value = null;
  if (!refocus) return;
  await nextTick();
  inRow(task.id, "[data-focus-target]")?.focus();
}

function onTitleKey(event: KeyboardEvent, task: Task) {
  if (event.key === "Escape") {
    event.preventDefault();
    void finishRename(task, false, true);
  } else if (event.key === "Enter") {
    event.preventDefault();
    void finishRename(task, true, true);
  }
}

// ── The row's menu and new to-dos ────────────────────────────────────

function choose(entry: Extract<Entry, { kind: "task" }>, action: RowAction) {
  const { task } = entry;
  if (action === "rename") return menuFocus.later(() => void startRename(task));
  if (action === "add-below" || action === "add-sub") {
    const level = entry.row.depth + (action === "add-sub" ? 1 : 0);
    return menuFocus.later(() => {
      panel.editing.value = null;
      panel.draft.value = { groupId: entry.group.id, afterId: task.id, level };
    });
  }
  if (action === "delete") return actions.remove(task);
  const run = rowChange(action, task);
  if (run) actions.change(run);
}

function addDraft(text: string) {
  const open = panel.draft.value;
  if (!open) return;
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const { groupId, afterId, level } = open;
  actions.change((data) => insertTask(data, groupId, afterId, level, { id, title: text, createdAt }));
  // The next one follows the new one, at the same level.
  panel.draft.value = { groupId, afterId: id, level };
}

/** The last line adds to the first group the plate shows (or the first group, or a new one when there is none). */
function add(text: string) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  // Made here, not in the change: a change runs again on the stored list, and the group must keep its id.
  const newGroupId = crypto.randomUUID();
  const target = props.list.groups.find((group) => !props.collapsed.includes(group.id)) ?? props.list.groups[0];
  const groupId = target?.id ?? null;
  actions.change((data) => addTask(data, groupId, { id, title: text, createdAt }, newGroupId));
}
</script>

<template>
  <ul ref="plateEl" :class="['live-plate', 'editing', style.classes]" :style="style.style" role="list" :aria-label="t('app.overGame')" data-testid="edit-plate">
    <template v-for="(entry, at) in entries" :key="entry.key">
      <li v-if="entry.kind === 'group'" :class="['head', at === 0 && 'first']">{{ entry.row.text }}</li>
      <li v-else-if="entry.kind === 'draft'" class="add" :style="indent(entry.depth)">
        <AddInput
          draft
          class="add-line"
          :placeholder="entry.depth ? t('group.addSub') : t('app.addTodo')"
          :maxlength="MAX.title"
          data-testid="plate-draft"
          @add="addDraft"
          @close="panel.draft.value = null"
        />
      </li>
      <li v-else :class="['task', entry.row.done && 'done']" :style="indent(entry.row.depth)" :data-focus-row="entry.task.id" :data-testid="`plate-task-${entry.task.id}`">
        <!-- rules-allow: kit-control the live view's own box (or pin), drawn as on the overlay page, so nothing changes when the layer opens -->
        <button
          type="button"
          :class="['tick', entry.row.pinned && 'pinned']"
          :aria-label="entry.row.done ? t('task.notDone', { title: entry.task.title }) : t('task.done', { title: entry.task.title })"
          data-testid="plate-done"
          data-focus-target
          @click="actions.setDone(entry.task, !entry.task.done)"
        >
          <span :class="entry.row.pinned ? 'mark pin' : 'mark box'">{{ entry.row.pinned ? "\u{1F4CC}" : "" }}</span>
        </button>
        <Textarea
          v-if="panel.editing.value === editKey(entry.task.id)"
          v-model="title"
          rows="1"
          class="title-input"
          :aria-label="t('task.title')"
          :maxlength="MAX.title"
          data-testid="plate-title-input"
          @keydown="onTitleKey($event, entry.task)"
          @blur="finishRename(entry.task, true)"
        />
        <span v-else class="text" data-testid="plate-title" @dblclick="startRename(entry.task)">{{ entry.row.text }}</span>
        <span v-if="entry.row.progress" class="progress">{{ entry.row.progress }}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            class="row-menu bg-popover text-popover-foreground flex items-center justify-center rounded-md border"
            :aria-label="t('moreFor', { name: entry.task.title })"
            :title="t('more')"
            data-testid="plate-task-menu"
          >
            <Ellipsis class="size-[0.9em]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" @close-auto-focus="menuFocus.closed">
            <RowMenuItems
              :entries="rowMenu({ task: entry.task, group: entry.group, groups: list.groups, index: entry.index, depth: entry.row.depth, compact: entry.row.pinned, rename: true, describe: false })"
              @choose="(action) => choose(entry, action)"
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    </template>
    <li class="add">
      <AddInput class="add-line" :placeholder="t('app.addTodo')" :maxlength="MAX.title" data-testid="plate-add" @add="add" />
    </li>
  </ul>
</template>
