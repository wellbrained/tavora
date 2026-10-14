<script setup lang="ts">
// One to-do: a checkbox and title, opened in place to edit details, a source
// link and steps. Its menu opens from the ⋯ button or a right-click and has
// keyboard alternatives for everything drag and drop does.
import { ArrowDown, ArrowUp, ChevronDown, Ellipsis, FolderInput, GripVertical, Link2, Pin, PinOff, Trash2, X } from "@lucide/vue";
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
import { computed, nextTick, ref, watch } from "vue";
import AddInput from "./AddInput.vue";
import type { TodoStore } from "./store";
import {
  addStep,
  deleteStep,
  deleteTask,
  MAX,
  moveTask,
  normalizeLink,
  setDone,
  shiftTask,
  updateStep,
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
  expanded: boolean;
  /** Where a dragged task would land relative to this one. */
  drop: "before" | "after" | null;
  /** Shown in the objectives list, where the group name is helpful and reordering is not. */
  compact?: boolean;
}>();
const emit = defineEmits<{ toggle: []; dragstart: [event: DragEvent]; dragend: [] }>();

const menuOpen = ref(false);
const title = ref(props.task.title);
const details = ref(props.task.details);
const link = ref(props.task.link);
const linkError = ref("");
const titleInput = ref<HTMLInputElement | null>(null);

// Follow changes from other panels unless this field is being edited.
watch(
  () => props.task,
  (task) => {
    if (document.activeElement !== titleInput.value) title.value = task.title;
    if (document.activeElement?.getAttribute("data-field") !== "details") details.value = task.details;
    if (document.activeElement?.getAttribute("data-field") !== "link") link.value = task.link;
  },
);

watch(
  () => props.expanded,
  async (open) => {
    if (!open) return;
    await nextTick();
    titleInput.value?.focus();
  },
);

const stepsDone = computed(() => props.task.steps.filter((step) => step.done).length);
const id = computed(() => props.task.id);
const now = () => new Date().toISOString();

// A change may run again on a newer list when another panel saved first, so
// every value it uses is read now, never inside it.
const change = (fn: Parameters<TodoStore["apply"]>[0]) => void props.store.apply(fn);
const checked = (event: Event) => (event.target as HTMLInputElement).checked;
const value = (event: Event) => (event.target as HTMLInputElement).value;

function setTaskDone(done: boolean) {
  const at = now();
  change((data) => setDone(data, id.value, done, at));
}

function setPinned(pinned: boolean) {
  change((data) => updateTask(data, id.value, { pinned }));
}

function setStep(stepId: string, patch: { title?: string; done?: boolean }) {
  change((data) => updateStep(data, id.value, stepId, patch));
}

function saveTitle() {
  const next = title.value;
  if (next.trim() && next.trim() !== props.task.title) change((data) => updateTask(data, id.value, { title: next }));
  else title.value = props.task.title;
}

function saveDetails() {
  const next = details.value;
  if (next !== props.task.details) change((data) => updateTask(data, id.value, { details: next }));
}

function saveLink() {
  const href = normalizeLink(link.value);
  if (href === null) {
    linkError.value = "Enter a web address such as https://example.com.";
    return;
  }
  linkError.value = "";
  link.value = href;
  if (href !== props.task.link) change((data) => updateTask(data, id.value, { link: href }));
}

function onTitleKey(event: KeyboardEvent) {
  if (event.key === "Enter") (event.target as HTMLInputElement).blur();
  if (event.key === "Escape") {
    title.value = props.task.title;
    (event.target as HTMLInputElement).blur();
  }
}

function newStep(text: string) {
  const stepId = crypto.randomUUID();
  change((data) => addStep(data, id.value, stepId, text));
}

const otherGroups = computed(() => props.groups.filter((group) => group.id !== props.group.id));
</script>

<template>
  <div
    :class="
      cn(
        'group/task relative rounded-md',
        expanded ? 'bg-card border' : 'hover:bg-accent',
        drop === 'before' && 'drop-before',
        drop === 'after' && 'drop-after',
      )
    "
    :data-testid="`task-${task.id}`"
    :data-done="task.done"
    :data-pinned="task.pinned"
    @contextmenu.prevent="menuOpen = true"
  >
    <div class="flex min-h-9 items-start gap-1.5 py-1 pr-1 pl-1">
      <span
        v-if="!compact"
        class="text-muted-foreground flex h-7 w-4 flex-none cursor-grab items-center justify-center opacity-0 group-hover/task:opacity-100"
        draggable="true"
        aria-hidden="true"
        title="Drag to move"
        @dragstart="emit('dragstart', $event)"
        @dragend="emit('dragend')"
      >
        <GripVertical class="size-3.5" :stroke-width="1.5" />
      </span>
      <!-- Controls sit in 28 px boxes, the height of the title's first line, so they line up with it. -->
      <span class="flex h-7 flex-none items-center px-0.5">
        <input
          type="checkbox"
          class="todo-check"
          :checked="task.done"
          :aria-label="task.done ? `Mark “${task.title}” as not done` : `Mark “${task.title}” as done`"
          data-testid="task-done"
          @change="setTaskDone(checked($event))"
        />
      </span>
      <button
        v-if="!expanded"
        type="button"
        class="flex min-w-0 flex-1 flex-col items-start rounded-sm px-1 py-1 text-left"
        :aria-expanded="false"
        data-testid="task-open"
        @click="emit('toggle')"
      >
        <span :class="cn('w-full text-sm leading-5 break-words', task.done && 'text-muted-foreground line-through')" data-testid="task-title">{{
          task.title
        }}</span>
        <span
          v-if="compact || task.steps.length || task.link || task.details"
          class="text-muted-foreground flex w-full min-w-0 items-center gap-2 text-xs"
        >
          <span v-if="compact" class="truncate">{{ group.name }}</span>
          <span v-if="task.steps.length" class="flex-none tabular-nums" data-testid="task-steps">{{ stepsDone }}/{{ task.steps.length }} steps</span>
          <Link2 v-if="task.link" class="size-3 flex-none" :stroke-width="1.5" aria-label="Has a source link" />
          <span v-if="task.details && !compact" class="truncate">{{ task.details }}</span>
        </span>
      </button>
      <input
        v-else
        ref="titleInput"
        v-model="title"
        class="focus-visible:border-ring h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-sm font-medium outline-none"
        aria-label="Title"
        data-testid="task-title-input"
        :maxlength="MAX.title"
        @blur="saveTitle"
        @keydown="onTitleKey"
      />
      <span v-if="task.pinned && !expanded && !compact" class="flex h-7 flex-none items-center">
        <Pin class="text-primary size-3.5" :stroke-width="1.5" aria-label="Pinned" />
      </span>
      <button
        v-if="expanded"
        type="button"
        class="text-muted-foreground hover:text-foreground flex size-7 flex-none items-center justify-center rounded-md"
        aria-label="Close details"
        title="Close details"
        data-testid="task-close"
        @click="emit('toggle')"
      >
        <ChevronDown class="size-4 rotate-180" :stroke-width="1.5" />
      </button>
      <DropdownMenu v-model:open="menuOpen">
        <DropdownMenuTrigger
          :class="
            cn(
              'text-muted-foreground hover:text-foreground flex size-7 flex-none items-center justify-center rounded-md opacity-0 group-hover/task:opacity-100 focus-visible:opacity-100',
              (expanded || menuOpen) && 'opacity-100',
            )
          "
          :aria-label="`More for ${task.title}`"
          title="More"
          data-testid="task-menu"
        >
          <Ellipsis class="size-4" :stroke-width="1.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem data-testid="menu-pin" @select="setPinned(!task.pinned)">
            <PinOff v-if="task.pinned" :stroke-width="1.5" />
            <Pin v-else :stroke-width="1.5" />
            {{ task.pinned ? "Unpin objective" : "Pin as current objective" }}
          </DropdownMenuItem>
          <template v-if="!compact">
            <DropdownMenuItem :disabled="index === 0" @select="change((data) => shiftTask(data, task.id, -1))">
              <ArrowUp :stroke-width="1.5" /> Move up
            </DropdownMenuItem>
            <DropdownMenuItem :disabled="index === group.tasks.length - 1" @select="change((data) => shiftTask(data, task.id, 1))">
              <ArrowDown :stroke-width="1.5" /> Move down
            </DropdownMenuItem>
            <DropdownMenuSub v-if="otherGroups.length">
              <DropdownMenuSubTrigger><FolderInput :stroke-width="1.5" /> Move to group</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  v-for="target in otherGroups"
                  :key="target.id"
                  @select="change((data) => moveTask(data, task.id, target.id, Number.MAX_SAFE_INTEGER))"
                >
                  {{ target.name }}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </template>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" data-testid="menu-delete" @select="change((data) => deleteTask(data, task.id))">
            <Trash2 :stroke-width="1.5" /> Delete to-do
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div v-if="expanded" class="flex flex-col gap-3 px-3 pt-1 pb-3" data-testid="task-details">
      <textarea
        v-model="details"
        data-field="details"
        data-testid="task-details-input"
        rows="3"
        :maxlength="MAX.details"
        placeholder="Details"
        aria-label="Details"
        class="placeholder:text-muted-foreground border-input focus-visible:border-ring field-sizing-content min-h-16 w-full resize-none rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none"
        @blur="saveDetails"
      />
      <div>
        <label class="text-muted-foreground mb-1 block text-xs" :for="`link-${task.id}`">Source link</label>
        <input
          :id="`link-${task.id}`"
          v-model="link"
          data-field="link"
          data-testid="task-link-input"
          placeholder="https://"
          :maxlength="MAX.link"
          :aria-invalid="linkError ? true : undefined"
          class="placeholder:text-muted-foreground border-input focus-visible:border-ring aria-invalid:border-destructive h-8 w-full min-w-0 rounded-md border bg-transparent px-2 text-sm outline-none"
          @blur="saveLink"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
        />
        <p v-if="linkError" class="text-destructive mt-1 text-xs" role="alert">{{ linkError }}</p>
      </div>
      <div>
        <p class="text-muted-foreground mb-1 text-xs">Steps</p>
        <ul role="list" data-testid="steps">
          <li v-for="step in task.steps" :key="step.id" class="group/step flex items-center gap-2 rounded-md pl-1" :data-testid="`step-${step.id}`">
            <input
              type="checkbox"
              class="todo-check todo-check-sm"
              :checked="step.done"
              :aria-label="`Step done: ${step.title}`"
              data-testid="step-done"
              @change="setStep(step.id, { done: checked($event) })"
            />
            <input
              :value="step.title"
              :class="
                cn(
                  'focus-visible:border-ring h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-sm outline-none',
                  step.done && 'text-muted-foreground line-through',
                )
              "
              aria-label="Step"
              :maxlength="MAX.title"
              @change="setStep(step.id, { title: value($event) })"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            />
            <button
              type="button"
              class="text-muted-foreground hover:text-destructive flex size-6 flex-none items-center justify-center rounded-md opacity-0 group-hover/step:opacity-100 focus-visible:opacity-100"
              :aria-label="`Delete step ${step.title}`"
              title="Delete step"
              @click="change((data) => deleteStep(data, task.id, step.id))"
            >
              <X class="size-3.5" :stroke-width="1.5" />
            </button>
          </li>
        </ul>
        <AddInput placeholder="Add a step" data-testid="add-step" :maxlength="MAX.title" @add="newStep" />
      </div>
    </div>
  </div>
</template>
