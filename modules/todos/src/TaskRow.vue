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
import { Check, ChevronRight, Ellipsis, GripVertical, Pin, Trash2 } from "@lucide/vue";
import { cn } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { isComposing } from "@tavora/official-ui/lib/keys";
import { Popover, PopoverAnchor, PopoverContent } from "@tavora/official-ui/components/ui/popover";
import { Textarea } from "@tavora/official-ui/components/ui/textarea";
import { computed, inject, nextTick, ref } from "vue";
import { t } from "./i18n";
import { PANEL, ROW_FOCUS } from "./panel";
import { afterMenu, rowChange, rowMenu, taskActions, type RowAction } from "./row";
import RowMenuItems from "./RowMenuItems.vue";
import type { TodoStore } from "./store";
import { canIndent, indentTask, MAX, outdentTask, updateTask, type Group, type Task } from "./todos";

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
/** Gives this row the focus back once Undo has brought it back. */
const rowFocus = inject(ROW_FOCUS, null);

const menuOpen = ref(false);
const title = ref("");
const titleField = ref<InstanceType<typeof Textarea> | null>(null);
const titleInput = () => titleField.value?.$el as HTMLTextAreaElement | undefined;
/** Set while a level change moves this row, so the focus it loses does not close the editor. */
let moving = false;

const id = computed(() => props.task.id);
// The objectives list shows the same task again; each copy has its own editor.
const editKey = computed(() => (props.compact ? `objective:${props.task.id}` : props.task.id));
const editing = computed(() => panel.editing.value === editKey.value);
const folded = computed(() => panel.folded.value.includes(props.task.id));
const hasMeta = computed(() => props.compact || props.children.total > 0 || props.task.details !== "");
// Finishing, deleting and renaming work the same over the game (row.ts). A change may run again on a newer list when
// another panel saved first, so every value it uses is read now, never inside it.
const actions = taskActions(props.store, panel, rowFocus);
const change = actions.change;
const setTaskDone = (done: boolean) => actions.setDone(props.task, done);
const remove = () => actions.remove(props.task);


// ── Editing the title in place ───────────────────────────────────────

async function startEdit() {
  title.value = props.task.title;
  panel.draft.value = null;
  panel.editing.value = editKey.value;
  await nextTick();
  const input = titleInput();
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
}

function save() {
  actions.rename(props.task, title.value);
}

function close(keep: boolean) {
  if (keep) save();
  if (editing.value) panel.editing.value = null;
}

/** Closes and saves once focus leaves the row, unless it went to this row's own controls. */
function onFocusOut(event: FocusEvent) {
  if (moving) return;
  const next = event.relatedTarget as Node | null;
  if (next && titleInput()?.closest("[data-task-row]")?.contains(next)) return;
  close(true);
}

async function changeLevel(outdent: boolean) {
  const taskId = id.value;
  if (outdent ? !props.task.parentId : !canIndent(props.group, props.index)) return;
  const caret = titleInput()?.selectionStart ?? null;
  save();
  moving = true;
  change((data) => (outdent ? outdentTask(data, taskId) : indentTask(data, taskId)));
  // Moving the row in the page takes the focus away; give it back where it was.
  await nextTick();
  moving = false;
  const input = titleInput();
  if (!editing.value || !input) return;
  input.focus();
  if (caret !== null) input.setSelectionRange(caret, caret);
}

function onTitleKey(event: KeyboardEvent) {
  // Enter and Escape belong to text an input method is still composing.
  if (isComposing(event)) return;
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
const descriptionInput = ref<InstanceType<typeof Textarea> | null>(null);
let cancelled = false;
/** A menu item that needs the focus (the description, a new to-do) runs once the menu has closed and let go of it. */
const menuFocus = afterMenu();

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

function focusDescription(event: Event) {
  event.preventDefault();
  const input = descriptionInput.value?.$el as HTMLTextAreaElement | undefined;
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
}

function onDescriptionKey(event: KeyboardEvent) {
  if (isComposing(event)) return;
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

/** The ⋯ menu (row.ts), built when it opens. */
const menuEntries = () => rowMenu({ task: props.task, group: props.group, groups: props.groups, index: props.index, depth: props.depth, compact: props.compact });

function choose(action: RowAction) {
  if (action === "describe") return menuFocus.later(() => setDescribing(true));
  if (action === "add-below") return menuFocus.later(() => addBelow(props.depth));
  if (action === "add-sub") return menuFocus.later(() => addBelow(props.depth + 1));
  if (action === "delete") return remove();
  const run = rowChange(action, props.task);
  if (run) change(run);
}
</script>

<template>
  <div
    :class="
      cn(
        'group/task relative rounded-md',
        editing ? 'bg-background' : 'hover:bg-accent/60',
        drop === 'before' && 'drop-before',
        drop === 'after' && 'drop-after',
      )
    "
    :style="!compact && depth ? { marginLeft: `${depth * 24}px` } : undefined"
    :data-testid="`task-${task.id}`"
    :data-focus-row="task.id"
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
        <GripVertical class="size-3.5" />
      </span>
      <span v-if="!compact" class="relative z-10 flex h-8 w-4 flex-none items-center justify-center">
        <Button
          v-if="children.total"
          variant="ghost"
          size="icon-xs"
          class="text-muted-foreground hover:text-foreground hover:bg-transparent"
          :aria-expanded="!folded"
          :aria-label="folded ? t('task.unfold', { title: task.title }) : t('task.fold', { title: task.title })"
          data-testid="task-fold"
          @click="panel.toggleFolded(task.id)"
        >
          <ChevronRight :class="cn('size-3.5 transition-transform', !folded && 'rotate-90')" />
        </Button>
      </span>
      <!-- The tick's hit area is a 32 px square around the circle (the control height), so it is easy to hit; a click anywhere in it ticks. It overlaps its neighbours by 4 px each side, so the row's layout stays as it was; the fold button sits above it. -->
      <span class="group/tick relative -mx-1 flex h-8 w-8 flex-none cursor-pointer items-center justify-center" data-testid="task-tick-area" @click.self="setTaskDone(!task.done)">
        <!-- Round, so it reads as a to-do rather than a setting. -->
        <Checkbox
          class="data-[state=checked]:before:-inset-[1.5px] group-hover/tick:border-primary size-5 cursor-pointer rounded-full border-[1.5px] border-[color-mix(in_oklab,var(--primary)_45%,var(--muted-foreground))]"
          :model-value="task.done"
          :aria-label="task.done ? t('task.notDone', { title: task.title }) : t('task.done', { title: task.title })"
          data-testid="task-done"
          @update:model-value="setTaskDone($event === true)"
        />
        <!-- A faint tick in the circle while you hover the area, in the row's colour: what a click will do. -->
        <Check v-if="!task.done" class="text-primary pointer-events-none absolute size-3 opacity-0 transition-opacity duration-(--duration-press) group-hover/tick:opacity-45" :stroke-width="3" aria-hidden="true" data-testid="task-tick-hint" />
      </span>

      <Popover :open="describing" @update:open="setDescribing">
        <PopoverAnchor as-child>
          <div class="flex min-w-0 flex-1 flex-col">
            <!-- The title and its editor have the same box, font and wrapping, so switching between them moves nothing. -->
            <!-- The field's 1px border is taken off the padding, so the text stays where the title was. -->
            <Textarea
              v-if="editing"
              ref="titleField"
              v-model="title"
              variant="bare"
              autosize
              class="block overflow-hidden rounded-sm px-[3px] py-[5px] font-(family-name:--todo-font) text-(length:--todo-text) leading-(--todo-leading) break-words"
              :aria-label="t('task.title')"
              data-testid="task-title-input"
              :maxlength="MAX.title"
              @keydown="onTitleKey"
              @focusout="onFocusOut"
            />
            <button
              v-else
              type="button"
              class="block w-full cursor-text rounded-sm px-1 py-1.5 text-left font-(family-name:--todo-font) text-(length:--todo-text) leading-(--todo-leading) break-words"
              :aria-label="t('task.edit', { title: task.title })"
              data-testid="task-open"
              data-focus-target
              @click="startEdit"
            >
              <!-- Done: the line draws across the title and the text fades to muted (the kit's .tavora-strike). -->
              <span :class="cn('tavora-strike', task.done && 'text-muted-foreground')" :data-struck="task.done || undefined" data-testid="task-title">{{ task.title }}</span>
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
          <Textarea
            ref="descriptionInput"
            v-model="description"
            :maxlength="MAX.details"
            :placeholder="t('task.description')"
            :aria-label="t('task.description')"
            data-testid="description-input"
            class="block max-h-60 min-h-20 resize-none px-2 py-1.5 text-sm"
            @keydown="onDescriptionKey"
          />
          <p class="text-muted-foreground mt-1.5 px-0.5 text-[11px]">{{ t("task.descriptionHint") }}</p>
        </PopoverContent>
      </Popover>

      <span v-if="task.pinned && !compact" class="flex h-8 flex-none items-center">
        <Pin class="text-primary size-3.5" :aria-label="t('task.pinned')" />
      </span>
      <!-- Deleting in one click, shown on hover; the toast can put it back. -->
      <span class="flex h-8 flex-none items-center">
        <Button
          type="button"
          variant="danger"
          size="icon-sm"
          class="size-7 opacity-0 group-hover/task:opacity-100 focus-visible:opacity-100"
          :aria-label="t('task.deleteTitle', { title: task.title })"
          :title="t('task.delete')"
          data-testid="task-delete"
          @click="remove"
        >
          <Trash2 class="size-4" />
        </Button>
      </span>
      <span class="flex h-8 flex-none items-center">
        <DropdownMenu v-model:open="menuOpen">
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              :class="
                cn(
                  'text-muted-foreground hover:text-foreground opacity-40 group-hover/task:opacity-100 hover:bg-transparent focus-visible:opacity-100',
                  (menuOpen || editing) && 'opacity-100',
                )
              "
              :aria-label="t('moreFor', { name: task.title })"
              :title="t('more')"
              data-testid="task-menu"
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" @close-auto-focus="menuFocus.closed">
            <RowMenuItems :entries="menuEntries()" @choose="choose" />
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  </div>
</template>
