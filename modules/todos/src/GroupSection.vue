<script setup lang="ts">
// One group of to-dos with its own add row. Tasks can be dragged inside and
// between groups; the menus offer the same moves without a mouse.
import { ArrowDown, ArrowUp, Check, ChevronRight, Ellipsis, ListX, Palette, Pencil, Trash2 } from "@lucide/vue";
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
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import AddInput from "./AddInput.vue";
import { plural, t } from "./i18n";
import type { TodoStore } from "./store";
import TaskRow from "./TaskRow.vue";
import { addTask, clearDone, GROUP_COLORS, MAX, moveGroup, openCount, renameGroup, setGroupColor, type Group, type GroupColor } from "./todos";

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

/** "None" first, then each color. */
const COLOR_OPTIONS: GroupColor[] = ["", ...GROUP_COLORS];
const colorName = (color: GroupColor) => (color ? t(`color.${color}`) : t("group.color.none"));

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
    :class="
      cn(
        'bg-card overflow-hidden rounded-lg border',
        drop?.groupId === group.id && (collapsed || !group.tasks.length) && 'border-primary bg-primary/10',
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
      data-testid="group-header"
      @click="onHeaderClick"
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
      <DropdownMenu>
        <DropdownMenuTrigger
          class="text-muted-foreground hover:text-foreground flex size-7 flex-none items-center justify-center rounded-md opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          :aria-label="t('moreFor', { name: group.name })"
          :title="t('more')"
          data-testid="group-menu"
        >
          <Ellipsis class="size-4" :stroke-width="1.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem data-testid="menu-rename" @select="startRename"><Pencil :stroke-width="1.5" /> {{ t("group.rename") }}</DropdownMenuItem>
          <DropdownMenuItem :disabled="position === 0" @select="change((data) => moveGroup(data, group.id, -1))">
            <ArrowUp :stroke-width="1.5" /> {{ t("group.moveUp") }}
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="position === groups.length - 1" @select="change((data) => moveGroup(data, group.id, 1))">
            <ArrowDown :stroke-width="1.5" /> {{ t("group.moveDown") }}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="menu-color"><Palette :stroke-width="1.5" /> {{ t("group.color") }}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                v-for="option in COLOR_OPTIONS"
                :key="option || 'none'"
                :data-testid="`menu-color-${option || 'none'}`"
                @select="change((data) => setGroupColor(data, group.id, option))"
              >
                <span class="color-swatch" :data-tint="option || undefined" aria-hidden="true" />
                {{ colorName(option) }}
                <Check v-if="group.color === option" class="ml-auto" :stroke-width="1.5" />
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem :disabled="!doneCount" data-testid="menu-clear-done" @select="change((data) => clearDone(data, group.id))">
            <ListX :stroke-width="1.5" /> {{ t("group.deleteFinished") }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" data-testid="menu-delete-group" @select="emit('remove')">
            <Trash2 :stroke-width="1.5" /> {{ t("group.delete") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>

    <div v-if="!collapsed" class="p-1">
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
        {{ plural("group.hidden", doneCount) }}
      </p>
      <AddInput
        align-to-tasks
        :placeholder="t('group.addTo', { name: group.name })"
        :maxlength="MAX.title"
        :data-testid="`add-task-${group.id}`"
        @add="add"
      />
    </div>
  </section>
</template>
