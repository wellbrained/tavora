<script setup lang="ts">
// To-Dos: current objectives on top, then the player's own groups. Every
// To-Dos panel of a game shows the same list; what is open, folded or
// hidden is each panel's own state.
import { Eye, EyeOff, FolderPlus } from "@lucide/vue";
import { ConfirmDialog, connectModule, errorMessage } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import type { TavoraSDK } from "@tavora/sdk";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import AddInput from "./AddInput.vue";
import GroupSection, { type DropTarget } from "./GroupSection.vue";
import { createTodoStore, type TodoStore } from "./store";
import TaskRow from "./TaskRow.vue";
import { addGroup, addTask, deleteGroup, findTask, LIST_ID, MAX, moveTask, parseList, pinnedTasks, type Group, type TodoList } from "./todos";

const EMPTY = parseList(null);

interface PanelState {
  expanded: string | null;
  hideDone: boolean;
  collapsed: string[];
}

const sdk = shallowRef<TavoraSDK | null>(null);
const store = shallowRef<TodoStore | null>(null);
const error = ref<string | null>(null);
const panel = ref<PanelState>({ expanded: null, hideDone: false, collapsed: [] });
const naming = ref(false);
const newGroupInput = ref<InstanceType<typeof AddInput> | null>(null);
const pendingGroup = shallowRef<Group | null>(null);
const dragging = ref<string | null>(null);
const drop = ref<DropTarget | null>(null);

const list = computed<TodoList>(() => store.value?.list.value ?? EMPTY);
const hasDone = computed(() => list.value.groups.some((group) => group.tasks.some((task) => task.done)));
const objectives = computed(() => pinnedTasks(list.value).filter(({ task }) => !panel.value.hideDone || !task.done));

const cleanup: (() => void)[] = [];

onMounted(async () => {
  try {
    const connected = await connectModule();
    const todos = createTodoStore(connected);
    const [state] = await Promise.all([connected.panel.getState<Partial<PanelState>>(), todos.load()]);
    panel.value = {
      expanded: typeof state?.expanded === "string" ? state.expanded : null,
      hideDone: state?.hideDone === true,
      collapsed: Array.isArray(state?.collapsed) ? state.collapsed.filter((id) => typeof id === "string") : [],
    };
    cleanup.push(connected.documents.onChange((change) => change.id === LIST_ID && void todos.reload()));
    sdk.value = connected;
    store.value = todos;
  } catch (reason) {
    error.value = errorMessage(reason);
  }
});

onBeforeUnmount(() => cleanup.forEach((fn) => fn()));

function setPanel(patch: Partial<PanelState>) {
  const next = { ...panel.value, ...patch };
  panel.value = next;
  // Plain values only: a Vue proxy cannot be sent to the host.
  void sdk.value?.panel.setState({ expanded: next.expanded, hideDone: next.hideDone, collapsed: [...next.collapsed] });
}

function toggleExpanded(taskId: string) {
  setPanel({ expanded: panel.value.expanded === taskId ? null : taskId });
}

function toggleCollapsed(groupId: string) {
  const collapsed = panel.value.collapsed.includes(groupId)
    ? panel.value.collapsed.filter((id) => id !== groupId)
    : [...panel.value.collapsed, groupId];
  setPanel({ collapsed });
}

async function startGroup() {
  naming.value = true;
  await nextTick();
  newGroupInput.value?.focus();
}

function createGroup(name: string) {
  const id = crypto.randomUUID();
  naming.value = false;
  void store.value!.apply((data) => addGroup(data, id, name));
}

function firstTask(text: string) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  void store.value!.apply((data) => addTask(data, null, { id, title: text, createdAt }, crypto.randomUUID()));
}

function removeGroup() {
  const group = pendingGroup.value!;
  pendingGroup.value = null;
  void store.value!.apply((data) => deleteGroup(data, group.id));
}

function askRemoveGroup(group: Group) {
  if (group.tasks.length) pendingGroup.value = group;
  else void store.value!.apply((data) => deleteGroup(data, group.id));
}

// ── Drag and drop ────────────────────────────────────────────────────

function dragStart(taskId: string, event: DragEvent) {
  dragging.value = taskId;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", findTask(list.value, taskId)?.task.title ?? "");
    const row = (event.target as HTMLElement).closest("[data-testid^='task-']");
    if (row) event.dataTransfer.setDragImage(row, 16, 16);
  }
}

function dragEnd() {
  dragging.value = null;
  drop.value = null;
}

function dropTask() {
  const taskId = dragging.value;
  const target = drop.value;
  dragEnd();
  if (!taskId || !target) return;
  const from = findTask(list.value, taskId);
  if (!from) return;
  // The target index counts the dragged task; moveTask counts without it.
  const index = from.group.id === target.groupId && from.index < target.index ? target.index - 1 : target.index;
  if (from.group.id === target.groupId && index === from.index) return;
  void store.value!.apply((data) => moveTask(data, taskId, target.groupId, index));
}
</script>

<template>
  <p v-if="!store" class="text-muted-foreground p-4 text-sm" data-testid="status">
    {{ error ? `Could not connect: ${error}` : "Loading to-dos…" }}
  </p>
  <div v-else class="flex h-full min-h-0 flex-col" data-testid="todos-app">
    <header class="flex h-10 flex-none items-center gap-1 border-b px-2">
      <p class="text-muted-foreground min-w-0 flex-1 truncate px-1 text-xs" role="status" data-testid="todos-status">
        <span v-if="store.error.value" class="text-destructive">{{ store.error.value }}</span>
      </p>
      <Button
        v-if="panel.hideDone || hasDone"
        variant="ghost"
        size="sm"
        data-testid="toggle-done"
        :aria-pressed="panel.hideDone"
        @click="setPanel({ hideDone: !panel.hideDone })"
      >
        <EyeOff v-if="!panel.hideDone" :stroke-width="1.5" />
        <Eye v-else :stroke-width="1.5" />
        {{ panel.hideDone ? "Show finished" : "Hide finished" }}
      </Button>
      <Button variant="ghost" size="sm" data-testid="new-group" @click="startGroup">
        <FolderPlus :stroke-width="1.5" /> New group
      </Button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-2" @dragend="dragEnd">
      <div v-if="!list.groups.length && !naming" class="flex flex-col items-center gap-3 px-4 py-10 text-center" data-testid="empty">
        <p class="text-muted-foreground text-sm">Keep track of what you want to do in this game.</p>
        <AddInput class="w-full max-w-80" outlined placeholder="Add a to-do" :maxlength="MAX.title" data-testid="first-task" @add="firstTask" />
      </div>

      <section v-if="objectives.length" class="mb-3" aria-label="Current objectives" data-testid="objectives">
        <h2 class="text-muted-foreground px-2 pt-1 pb-1 text-xs font-medium">Current objectives</h2>
        <ul role="list">
          <li v-for="{ task, group } in objectives" :key="task.id">
            <TaskRow
              :store="store"
              :task="task"
              :group="group"
              :groups="list.groups"
              :index="group.tasks.indexOf(task)"
              :expanded="false"
              :drop="null"
              compact
              @toggle="toggleExpanded(task.id)"
            />
          </li>
        </ul>
      </section>

      <div class="flex flex-col gap-2">
        <GroupSection
          v-for="(group, position) in list.groups"
          :key="group.id"
          :store="store"
          :group="group"
          :groups="list.groups"
          :position="position"
          :collapsed="panel.collapsed.includes(group.id)"
          :hide-done="panel.hideDone"
          :expanded-id="panel.expanded"
          :dragging="dragging !== null"
          :drop="drop"
          @toggle-collapsed="toggleCollapsed(group.id)"
          @expand="toggleExpanded"
          @remove="askRemoveGroup(group)"
          @dragstart="dragStart"
          @dragend="dragEnd"
          @dragover="(target) => (drop = target)"
          @drop="dropTask"
        />
      </div>

      <AddInput
        v-if="naming"
        ref="newGroupInput"
        class="mt-2"
        placeholder="Name the group, e.g. Bosses"
        label="New group name"
        :maxlength="MAX.groupName"
        data-testid="group-name-new"
        @add="createGroup"
        @focusout="naming = false"
      />
    </div>

    <ConfirmDialog
      v-if="pendingGroup"
      :title="`Delete “${pendingGroup.name}”?`"
      :description="`Its ${pendingGroup.tasks.length} ${pendingGroup.tasks.length === 1 ? 'to-do is' : 'to-dos are'} removed for good. This cannot be undone.`"
      confirm="Delete group"
      @confirm="removeGroup"
      @cancel="pendingGroup = null"
    />
  </div>
</template>
