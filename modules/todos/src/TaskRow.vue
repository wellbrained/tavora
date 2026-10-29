<script setup lang="ts">
// One to-do: a checkbox and title, edited in place by clicking the title.
// The editor takes exactly the title's place, so the row keeps its height
// and nothing around it moves. While editing, Tab and Shift+Tab change its
// level. The description is written in a popover from the menu, which opens
// from the ⋯ button or a right-click and has keyboard alternatives for
// everything drag and drop does.
//
// Every control sits in a box as tall as one title line (32 px), so all of
// them share the first line's centre.
import { AlignLeft, ArrowDown, ArrowUp, ChevronRight, CornerDownRight, Ellipsis, FolderInput, GripVertical, IndentDecrease, IndentIncrease, ListPlus, Pin, PinOff, Trash2 } from "@lucide/vue";
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
import { Popover, PopoverAnchor, PopoverContent } from "@tavora/official-ui/components/ui/popover";
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
const titleInput = ref<HTMLTextAreaElement | null>(null);
/** Set while a level change moves this row, so the focus it loses does not close the editor. */
let moving = false;

const id = computed(() => props.task.id);
// The objectives list shows the same task again; each copy has its own editor.
const editKey = computed(() => (props.compact ? `objective:${props.task.id}` : props.task.id));
const editing = computed(() => panel.editing.value === editKey.value);
const folded = computed(() => panel.folded.value.includes(props.task.id));
const hasMeta = computed(() => props.compact || props.children.total > 0 || props.task.details !== "");
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

// ── Editing the title in place ───────────────────────────────────────

async function startEdit() {
  title.value = props.task.title;
  panel.draft.value = null;
  panel.editing.value = editKey.value;
  await nextTick();
  const input = titleInput.value;
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
}

function save() {
  const taskId = id.value;
  // A title is one line; pasted line breaks become spaces.
  const next = title.value.replace(/\s*\n\s*/g, " ");
  if (next.trim() && next.trim() !== props.task.title) change((data) => updateTask(data, taskId, { title: next }));
}

function close(keep: boolean) {
  if (keep) save();
  if (editing.value) panel.editing.value = null;
}

/** Closes and saves once focus leaves the row, unless it went to this row's own controls. */
function onFocusOut(event: FocusEvent) {
  if (moving) return;
  const next = event.relatedTarget as Node | null;
  if (next && titleInput.value?.closest("[data-task-row]")?.contains(next)) return;
  close(true);
}

async function changeLevel(outdent: boolean) {
  const taskId = id.value;
  if (outdent ? !props.task.parentId : !canIndent(props.group, props.index)) return;
  const caret = titleInput.value?.selectionStart ?? null;
  save();
  moving = true;
  change((data) => (outdent ? outdentTask(data, taskId) : indentTask(data, taskId)));
  // Moving the row in the page takes the focus away; give it back where it was.
  await nextTick();
  moving = false;
  if (!editing.value || !titleInput.value) return;
  titleInput.value.focus();
  if (caret !== null) titleInput.value.setSelectionRange(caret, caret);
}

function onTitleKey(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    close(false);
  } else if (event.key === "Enter") {
    event.preventDefault();
    close(true);
    // Like the add row at the end: a new to-do opens right below, ready to type.
    if (!props.compact) addBelow(props.depth);
  } else if (event.key === "Tab" && !props.compact) {
    event.preventDefault();
    void changeLevel(event.shiftKey);
  }
}

/** Opens a new to-do right after this one and its sub-to-dos: at its level, or one deeper as its last sub-to-do. */
function addBelow(level: number) {
  if (level > props.depth && folded.value) panel.toggleFolded(id.value);
  panel.editing.value = null;
  panel.draft.value = { groupId: props.group.id, afterId: id.value, level };
}

// ── The description, in a popover ────────────────────────────────────

const describing = ref(false);
const description = ref("");
const descriptionInput = ref<HTMLTextAreaElement | null>(null);
let cancelled = false;
/** A menu item that needs the focus (the description, a new to-do) runs once the menu has closed and let go of it. */
let afterMenu: (() => void) | null = null;
const later = (run: () => void) => (afterMenu = run);

function setDescribing(open: boolean) {
  if (open) {
    description.value = props.task.details;
    cancelled = false;
  } else if (!cancelled && description.value !== props.task.details) {
    const taskId = id.value;
    const details = description.value;
    change((data) => updateTask(data, taskId, { details }));
  }
  describing.value = open;
}

function cancelDescription() {
  cancelled = true;
}

function onMenuClosed(event: Event) {
  const run = afterMenu;
  if (!run) return;
  afterMenu = null;
  event.preventDefault();
  run();
}

function focusDescription(event: Event) {
  event.preventDefault();
  const input = descriptionInput.value;
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
}

function onDescriptionKey(event: KeyboardEvent) {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    setDescribing(false);
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
        editing ? 'bg-background ring-ring/60 ring-1' : 'hover:bg-accent/60',
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
    <div class="flex items-start gap-1.5 py-0.5 pr-1 pl-0.5">
      <span
        v-if="!compact"
        class="text-muted-foreground flex h-8 w-4 flex-none cursor-grab items-center justify-center opacity-0 group-hover/task:opacity-100"
        draggable="true"
        aria-hidden="true"
        :title="t('task.drag')"
        @dragstart="emit('dragstart', $event)"
        @dragend="emit('dragend')"
      >
        <GripVertical class="size-3.5" :stroke-width="1.5" />
      </span>
      <span v-if="!compact" class="flex h-8 w-4 flex-none items-center justify-center">
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
      <span class="flex h-8 flex-none items-center px-0.5">
        <input
          type="checkbox"
          class="todo-check"
          :checked="task.done"
          :aria-label="task.done ? t('task.notDone', { title: task.title }) : t('task.done', { title: task.title })"
          data-testid="task-done"
          @change="setTaskDone(checked($event))"
        />
      </span>

      <Popover :open="describing" @update:open="setDescribing">
        <PopoverAnchor as-child>
          <div class="flex min-w-0 flex-1 flex-col">
            <!-- The title and its editor have the same box, font and wrapping, so switching between them moves nothing. -->
            <textarea
              v-if="editing"
              ref="titleInput"
              v-model="title"
              rows="1"
              class="block field-sizing-content w-full resize-none overflow-hidden border-0 bg-transparent px-1 py-1.5 text-sm leading-5 break-words outline-none"
              :aria-label="t('task.title')"
              data-testid="task-title-input"
              :maxlength="MAX.title"
              @keydown="onTitleKey"
              @focusout="onFocusOut"
            />
            <button
              v-else
              type="button"
              class="block w-full cursor-text rounded-sm px-1 py-1.5 text-left text-sm leading-5 break-words"
              :aria-label="t('task.edit', { title: task.title })"
              data-testid="task-open"
              @click="startEdit"
            >
              <span :class="cn(task.done && 'text-muted-foreground line-through')" data-testid="task-title">{{ task.title }}</span>
            </button>
            <div v-if="hasMeta" class="text-muted-foreground -mt-1 flex min-w-0 items-center gap-2 px-1 pb-1.5 text-xs leading-4">
              <span v-if="compact" class="truncate">{{ group.name }}</span>
              <span
                v-if="children.total"
                class="flex-none tabular-nums"
                :aria-label="t('task.children', children)"
                data-testid="task-children"
                v-text="`${children.done}/${children.total}`"
              />
              <span v-if="task.details" class="truncate" data-testid="task-details-preview">{{ task.details }}</span>
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent
          side="bottom"
          align="start"
          :side-offset="4"
          :collision-padding="8"
          class="p-2"
          data-testid="description-popover"
          @open-auto-focus="focusDescription"
          @escape-key-down="cancelDescription"
        >
          <textarea
            ref="descriptionInput"
            v-model="description"
            :maxlength="MAX.details"
            :placeholder="t('task.description')"
            :aria-label="t('task.description')"
            data-testid="description-input"
            class="placeholder:text-muted-foreground border-input focus-visible:border-ring field-sizing-content block max-h-60 min-h-20 w-full resize-none rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none"
            @keydown="onDescriptionKey"
          />
          <p class="text-muted-foreground mt-1.5 px-0.5 text-[11px]">{{ t("task.descriptionHint") }}</p>
        </PopoverContent>
      </Popover>

      <span v-if="task.pinned && !compact" class="flex h-8 flex-none items-center">
        <Pin class="text-primary size-3.5" :stroke-width="1.5" :aria-label="t('task.pinned')" />
      </span>
      <!-- Deleting in one click, shown on hover; the toast can put it back. -->
      <span class="flex h-8 flex-none items-center">
        <button
          type="button"
          class="text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex size-7 items-center justify-center rounded-md opacity-0 group-hover/task:opacity-100 focus-visible:opacity-100"
          :aria-label="t('task.deleteTitle', { title: task.title })"
          :title="t('task.delete')"
          data-testid="task-delete"
          @click="remove"
        >
          <Trash2 class="size-4" :stroke-width="1.5" />
        </button>
      </span>
      <span class="flex h-8 flex-none items-center">
        <DropdownMenu v-model:open="menuOpen">
          <DropdownMenuTrigger
            :class="
              cn(
                'text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-md opacity-40 group-hover/task:opacity-100 focus-visible:opacity-100',
                (menuOpen || editing) && 'opacity-100',
              )
            "
            :aria-label="t('moreFor', { name: task.title })"
            :title="t('more')"
            data-testid="task-menu"
          >
            <Ellipsis class="size-4" :stroke-width="1.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" @close-auto-focus="onMenuClosed">
            <DropdownMenuItem data-testid="menu-description" @select="later(() => setDescribing(true))">
              <AlignLeft :stroke-width="1.5" />
              {{ task.details ? t("task.editDescription") : t("task.addDescription") }}
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="menu-pin" @select="setPinned(!task.pinned)">
              <PinOff v-if="task.pinned" :stroke-width="1.5" />
              <Pin v-else :stroke-width="1.5" />
              {{ task.pinned ? t("task.unpin") : t("task.pin") }}
            </DropdownMenuItem>
            <template v-if="!compact">
              <DropdownMenuItem data-testid="menu-add-below" @select="later(() => addBelow(depth))">
                <ListPlus :stroke-width="1.5" /> {{ t("task.addBelow") }}
              </DropdownMenuItem>
              <DropdownMenuItem :disabled="depth >= MAX_DEPTH" data-testid="menu-add-sub" @select="later(() => addBelow(depth + 1))">
                <CornerDownRight :stroke-width="1.5" /> {{ t("task.addSub") }}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
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
      </span>
    </div>
  </div>
</template>
