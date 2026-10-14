<script setup lang="ts">
// One group of to-dos with its own add row. Tasks can be dragged inside and
// between groups; the menus offer the same moves without a mouse.
import { ArrowDown, ArrowUp, ChevronRight, Ellipsis, ListX, Pencil, Trash2 } from "@lucide/vue";
import { cn } from "@tavora/official-ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tavora/official-ui/components/ui/dropdown-menu";
import { computed, nextTick, ref } from "vue";
import AddInput from "./AddInput.vue";
import type { TodoStore } from "./store";
import TaskRow from "./TaskRow.vue";
import { addTask, clearDone, MAX, moveGroup, openCount, renameGroup, type Group } from "./todos";

export interface DropTarget {
  groupId: string;
  /** Position among the group's tasks, counted with the dragged task still in place. */
  index: number;
}

const props = defineProps<{
  store: TodoStore;
  group: Group;
  groups: Group[];
  position: number;
  collapsed: boolean;
  hideDone: boolean;
  expandedId: string | null;
  dragging: boolean;
  drop: DropTarget | null;
}>();
const emit = defineEmits<{
  toggleCollapsed: [];
  expand: [taskId: string];
  remove: [];
  dragstart: [taskId: string, event: DragEvent];
  dragend: [];
  dragover: [target: DropTarget];
  drop: [];
}>();

const renaming = ref(false);
const nameInput = ref<HTMLInputElement | null>(null);
const remaining = computed(() => openCount(props.group));
const doneCount = computed(() => props.group.tasks.length - remaining.value);
const visible = computed(() =>
  props.group.tasks.map((task, index) => ({ task, index })).filter(({ task }) => !props.hideDone || !task.done),
);
const change = (fn: Parameters<TodoStore["apply"]>[0]) => void props.store.apply(fn);

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

function add(text: string) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  change((data) => addTask(data, props.group.id, { id, title: text, createdAt }, crypto.randomUUID()));
}

function overTask(event: DragEvent, index: number) {
  if (!props.dragging) return;
  event.preventDefault();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;
  emit("dragover", { groupId: props.group.id, index: after ? index + 1 : index });
}

function overGroup(event: DragEvent) {
  if (!props.dragging) return;
  event.preventDefault();
  if (event.target === event.currentTarget || props.collapsed) emit("dragover", { groupId: props.group.id, index: props.group.tasks.length });
}

function dropMark(index: number): "before" | "after" | null {
  if (!props.drop || props.drop.groupId !== props.group.id) return null;
  if (props.drop.index === index) return "before";
  if (props.drop.index === index + 1 && index === props.group.tasks.length - 1) return "after";
  return null;
}
</script>

<template>
  <section
    :class="cn('rounded-md', drop?.groupId === group.id && (collapsed || !group.tasks.length) && 'bg-primary/15')"
    :aria-label="group.name"
    :data-testid="`group-${group.id}`"
    @dragover="overGroup"
    @drop.prevent="emit('drop')"
  >
    <header class="group/header flex h-9 items-center gap-1 pr-1 pl-1">
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground flex size-6 flex-none items-center justify-center rounded-md"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? `Show ${group.name}` : `Hide ${group.name}`"
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
        aria-label="Group name"
        data-testid="group-name-input"
        class="focus-visible:border-ring h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-sm font-semibold outline-none"
        @blur="finishRename"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
        @keydown.escape="renaming = false"
      />
      <h2 v-else class="min-w-0 flex-1 truncate px-1 text-sm font-semibold" data-testid="group-name" @dblclick="startRename">
        {{ group.name }}
      </h2>
      <span class="text-muted-foreground flex-none text-xs tabular-nums" data-testid="group-count">
        {{ group.tasks.length ? (remaining ? `${remaining} left` : "All done") : "" }}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          class="text-muted-foreground hover:text-foreground flex size-7 flex-none items-center justify-center rounded-md opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          :aria-label="`More for ${group.name}`"
          title="More"
          data-testid="group-menu"
        >
          <Ellipsis class="size-4" :stroke-width="1.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem data-testid="menu-rename" @select="startRename"><Pencil :stroke-width="1.5" /> Rename group</DropdownMenuItem>
          <DropdownMenuItem :disabled="position === 0" @select="change((data) => moveGroup(data, group.id, -1))">
            <ArrowUp :stroke-width="1.5" /> Move group up
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="position === groups.length - 1" @select="change((data) => moveGroup(data, group.id, 1))">
            <ArrowDown :stroke-width="1.5" /> Move group down
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="!doneCount" data-testid="menu-clear-done" @select="change((data) => clearDone(data, group.id))">
            <ListX :stroke-width="1.5" /> Delete finished to-dos
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" data-testid="menu-delete-group" @select="emit('remove')">
            <Trash2 :stroke-width="1.5" /> Delete group…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>

    <div v-if="!collapsed" class="pb-1 pl-1">
      <ul role="list">
        <li v-for="{ task, index } in visible" :key="task.id" @dragover="overTask($event, index)">
          <TaskRow
            :store="store"
            :task="task"
            :group="group"
            :groups="groups"
            :index="index"
            :expanded="expandedId === task.id"
            :drop="dropMark(index)"
            @toggle="emit('expand', task.id)"
            @dragstart="(event) => emit('dragstart', task.id, event)"
            @dragend="emit('dragend')"
          />
        </li>
      </ul>
      <p v-if="hideDone && doneCount && !visible.length" class="text-muted-foreground px-3 py-1 text-xs">
        {{ doneCount }} finished {{ doneCount === 1 ? "to-do" : "to-dos" }} hidden.
      </p>
      <AddInput
        class="ml-1"
        :placeholder="`Add to ${group.name}`"
        :maxlength="MAX.title"
        :data-testid="`add-task-${group.id}`"
        @add="add"
      />
    </div>
  </section>
</template>
