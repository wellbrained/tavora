<script setup lang="ts">
// One to-do: a checkbox and title, edited in place by clicking the title.
// While editing, Tab and Shift+Tab change its level. Its menu opens from the
// ⋯ button or a right-click and has keyboard alternatives for everything drag
// and drop does.
import { ArrowDown, ArrowUp, ChevronRight, Ellipsis, FolderInput, GripVertical, IndentDecrease, IndentIncrease, Pin, PinOff, Trash2 } from "@lucide/vue";
import { cn } from "@tavora/official-ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@tavora/official-ui/components/ui/dropdown-menu";
import { computed, inject, nextTick, ref } from "vue";
import { t } from "./i18n";
import { PANEL } from "./panel";
import type { TodoStore } from "./store";
import {
  canIndent,
  canShift,
  deleteTask,
  doneState,
  indentTask,
  MAX,
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
} from "./todos";

const props = defineProps<{
  store: TodoStore;
  task: Task;
  group: Group;
  groups: Group[];
  index: number;
  /** How far it is indented; 0 at the top level. */
  depth: number;
  /** Its direct sub-to-dos. */
  children: { done: number; total: number };
  /** Where a dragged task would land relative to this one. */
  drop: "before" | "after" | null;
  /** Shown in the objectives list, where the group name is helpful and nesting and reordering are not. */
  compact?: boolean;
}>();
const emit = defineEmits<{ dragstart: [event: DragEvent]; dragend: [] }>();
const panel = inject(PANEL)!;

const menuOpen = ref(false);
const title = ref("");
const details = ref("");
const editor = ref<HTMLElement | null>(null);
const titleInput = ref<HTMLInputElement | null>(null);
const detailsInput = ref<HTMLTextAreaElement | null>(null);
/** Set while a level change moves this row, so the focus it loses does not close the editor. */
let moving = false;

const id = computed(() => props.task.id);
// The objectives list shows the same task again; each copy has its own editor.
const editKey = computed(() => (props.compact ? `objective:${props.task.id}` : props.task.id));
const editing = computed(() => panel.editing.value === editKey.value);
const folded = computed(() => panel.folded.value.includes(props.task.id));
const now = () => new Date().toISOString();

// A change may run again on a newer list when another panel saved first, so
// every value it uses is read now, never inside it.
const change = (fn: Parameters<TodoStore["apply"]>[0]) => void props.store.apply(fn);
const checked = (event: Event) => (event.target as HTMLInputElement).checked;

function setTaskDone(done: boolean) {
  const at = now();
  const before = doneState(props.store.list.value, id.value);
  const taskId = id.value;
  if (done) panel.linger(taskId, props.task.pinned);
  change((data) => setDone(data, taskId, done, at));
  if (done) panel.offerUndo(t("app.undoFinished", { title: props.task.title }), () => change((data) => restoreDone(data, before)));
}

function remove() {
  const removed = removedBlock(props.store.list.value, id.value);
  const taskId = id.value;
  change((data) => deleteTask(data, taskId));
  if (removed) panel.offerUndo(t("app.undoDeleted", { title: props.task.title }), () => change((data) => restoreBlock(data, removed)));
}

function setPinned(pinned: boolean) {
  const taskId = id.value;
  change((data) => updateTask(data, taskId, { pinned }));
}

// ── Editing in place ─────────────────────────────────────────────────

async function startEdit(field: "title" | "details" = "title") {
  title.value = props.task.title;
  details.value = props.task.details;
  panel.editing.value = editKey.value;
  await nextTick();
  const input = field === "title" ? titleInput.value : detailsInput.value;
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
}

function save() {
  const taskId = id.value;
  const patch = { title: title.value, details: details.value };
  if (patch.title.trim() !== props.task.title || patch.details !== props.task.details) change((data) => updateTask(data, taskId, patch));
}

function close(keep: boolean) {
  if (keep) save();
  if (editing.value) panel.editing.value = null;
}

/** Closes and saves once focus leaves the editor, unless it went to this row's menu. */
function onFocusOut(event: FocusEvent) {
  if (moving) return;
  const next = event.relatedTarget as Node | null;
  if (next && editor.value?.closest("[data-task-row]")?.contains(next)) return;
  close(true);
}

async function changeLevel(outdent: boolean) {
  if (props.compact) return;
  const taskId = id.value;
  if (outdent ? !props.task.parentId : !canIndent(props.group, props.index)) return;
  const field = document.activeElement === detailsInput.value ? detailsInput.value : titleInput.value;
  const caret = field?.selectionStart ?? null;
  save();
  moving = true;
  change((data) => (outdent ? outdentTask(data, taskId) : indentTask(data, taskId)));
  // Moving the row in the page takes the focus away; give it back where it was.
  await nextTick();
  moving = false;
  if (!editing.value || !field) return;
  field.focus();
  if (caret !== null) field.setSelectionRange(caret, caret);
}

function onEditorKey(event: KeyboardEvent, field: "title" | "details") {
  if (event.key === "Escape") {
    event.preventDefault();
    close(false);
  } else if (event.key === "Enter" && (field === "title" || event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    close(true);
  } else if (event.key === "Tab" && !props.compact) {
    event.preventDefault();
    void changeLevel(event.shiftKey);
  } else if (field === "title" && event.key === "ArrowDown") {
    event.preventDefault();
    detailsInput.value?.focus();
  } else if (field === "details" && event.key === "ArrowUp" && detailsInput.value?.selectionStart === 0) {
    event.preventDefault();
    titleInput.value?.focus();
  }
}

// Inside the editor the usual menu stays, for copy and paste.
function onContextMenu(event: MouseEvent) {
  if (editing.value) return;
  event.preventDefault();
  menuOpen.value = true;
}

const otherGroups = computed(() => props.groups.filter((group) => group.id !== props.group.id));
</script>

<template>
  <div
    :class="
      cn(
        'group/task relative rounded-md',
        editing ? 'bg-background my-1 border' : 'hover:bg-accent/60',
        drop === 'before' && 'drop-before',
        drop === 'after' && 'drop-after',
      )
    "
    :style="!compact && depth ? { marginLeft: `${depth * 24}px` } : undefined"
    :data-testid="`task-${task.id}`"
    :data-done="task.done"
    :data-pinned="task.pinned"
    :data-depth="depth"
    data-task-row
    @contextmenu="onContextMenu"
  >
    <div class="flex min-h-9 items-start gap-1.5 py-1 pr-1 pl-0.5">
      <span
        v-if="!compact"
        class="text-muted-foreground flex h-[32px] w-4 flex-none cursor-grab items-center justify-center opacity-0 group-hover/task:opacity-100"
        draggable="true"
        aria-hidden="true"
        :title="t('task.drag')"
        @dragstart="emit('dragstart', $event)"
        @dragend="emit('dragend')"
      >
        <GripVertical class="size-3.5" :stroke-width="1.5" />
      </span>
      <span v-if="!compact" class="flex h-[32px] w-4 flex-none items-center justify-center">
        <button
          v-if="children.total"
          type="button"
          class="text-muted-foreground hover:text-foreground flex size-5 items-center justify-center rounded-sm"
          :aria-expanded="!folded"
          :aria-label="folded ? t('task.unfold', { title: task.title }) : t('task.fold', { title: task.title })"
          data-testid="task-fold"
          @click="panel.toggleFolded(task.id)"
        >
          <ChevronRight :class="cn('size-3.5 transition-transform', !folded && 'rotate-90')" :stroke-width="1.5" />
        </button>
      </span>
      <!-- Controls sit in boxes as tall as a one-line title (buttons are at least 32 px), so they line up with its first line. -->
      <span class="flex h-[32px] flex-none items-center px-0.5">
        <input
          type="checkbox"
          class="todo-check"
          :checked="task.done"
          :aria-label="task.done ? t('task.notDone', { title: task.title }) : t('task.done', { title: task.title })"
          data-testid="task-done"
          @change="setTaskDone(checked($event))"
        />
      </span>
      <button
        v-if="!editing"
        type="button"
        class="flex min-w-0 flex-1 cursor-text flex-col items-start justify-center rounded-sm px-1 py-1 text-left"
        :aria-label="t('task.edit', { title: task.title })"
        data-testid="task-open"
        @click="startEdit()"
      >
        <span :class="cn('w-full text-sm leading-5 break-words', task.done && 'text-muted-foreground line-through')" data-testid="task-title">{{
          task.title
        }}</span>
        <span v-if="compact || children.total || task.details" class="text-muted-foreground flex w-full min-w-0 items-center gap-2 text-xs">
          <span v-if="compact" class="truncate">{{ group.name }}</span>
          <span
            v-if="children.total"
            class="flex-none tabular-nums"
            :aria-label="t('task.children', children)"
            data-testid="task-children"
            v-text="`${children.done}/${children.total}`"
          />
          <span v-if="task.details" class="truncate" data-testid="task-details-preview">{{ task.details }}</span>
        </span>
      </button>
      <div v-else ref="editor" class="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5" data-testid="task-editor" @focusout="onFocusOut">
        <input
          ref="titleInput"
          v-model="title"
          class="h-7 min-w-0 rounded-md bg-transparent px-1 text-sm font-medium outline-none"
          :aria-label="t('task.title')"
          data-testid="task-title-input"
          :maxlength="MAX.title"
          @keydown="onEditorKey($event, 'title')"
        />
        <textarea
          ref="detailsInput"
          v-model="details"
          rows="1"
          :maxlength="MAX.details"
          :placeholder="t('task.description')"
          :aria-label="t('task.description')"
          data-testid="task-details-input"
          class="placeholder:text-muted-foreground field-sizing-content min-h-6 w-full resize-none bg-transparent px-1 text-xs leading-5 outline-none"
          @keydown="onEditorKey($event, 'details')"
        />
        <p class="text-muted-foreground/80 px-1 pt-1 text-[11px]" aria-hidden="true">{{ t("task.editorHint") }}</p>
      </div>
      <span v-if="task.pinned && !editing && !compact" class="flex h-[32px] flex-none items-center">
        <Pin class="text-primary size-3.5" :stroke-width="1.5" aria-label="Pinned" />
      </span>
      <DropdownMenu v-model:open="menuOpen">
        <DropdownMenuTrigger
          :class="
            cn(
              'text-muted-foreground hover:text-foreground flex size-7 flex-none items-center justify-center rounded-md opacity-0 group-hover/task:opacity-100 focus-visible:opacity-100',
              menuOpen && 'opacity-100',
            )
          "
          :aria-label="t('moreFor', { name: task.title })"
          :title="t('more')"
          data-testid="task-menu"
        >
          <Ellipsis class="size-4" :stroke-width="1.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem data-testid="menu-pin" @select="setPinned(!task.pinned)">
            <PinOff v-if="task.pinned" :stroke-width="1.5" />
            <Pin v-else :stroke-width="1.5" />
            {{ task.pinned ? t("task.unpin") : t("task.pin") }}
          </DropdownMenuItem>
          <template v-if="!compact">
            <DropdownMenuItem :disabled="!canIndent(group, index)" data-testid="menu-indent" @select="change((data) => indentTask(data, task.id))">
              <IndentIncrease :stroke-width="1.5" /> {{ t("task.indent") }}
            </DropdownMenuItem>
            <DropdownMenuItem :disabled="!task.parentId" data-testid="menu-outdent" @select="change((data) => outdentTask(data, task.id))">
              <IndentDecrease :stroke-width="1.5" /> {{ t("task.outdent") }}
            </DropdownMenuItem>
            <DropdownMenuItem :disabled="!canShift(group, index, -1)" @select="change((data) => shiftTask(data, task.id, -1))">
              <ArrowUp :stroke-width="1.5" /> {{ t("task.moveUp") }}
            </DropdownMenuItem>
            <DropdownMenuItem :disabled="!canShift(group, index, 1)" @select="change((data) => shiftTask(data, task.id, 1))">
              <ArrowDown :stroke-width="1.5" /> {{ t("task.moveDown") }}
            </DropdownMenuItem>
            <DropdownMenuSub v-if="otherGroups.length">
              <DropdownMenuSubTrigger><FolderInput :stroke-width="1.5" /> {{ t("task.moveToGroup") }}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem v-for="target in otherGroups" :key="target.id" @select="change((data) => moveTask(data, task.id, target.id, null))">
                  {{ target.name }}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </template>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" data-testid="menu-delete" @select="remove">
            <Trash2 :stroke-width="1.5" /> {{ t("task.delete") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>
