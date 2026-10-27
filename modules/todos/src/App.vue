<script setup lang="ts">
// To-Dos: a toolbar, current objectives, then the user's own groups. Every
// To-Dos panel of a workspace shows the same list; what is folded, hidden or being
// edited is each panel's own state.
import { Check, ChevronsDownUp, ChevronsUpDown, Eye, ListChecks } from "@lucide/vue";
import { ConfirmDialog, connectModule, errorMessage } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Toaster, toast } from "@tavora/official-ui/components/ui/toast";
import { Popover, PopoverContent, PopoverTrigger } from "@tavora/official-ui/components/ui/popover";
import { Slider } from "@tavora/official-ui/components/ui/slider";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import type { MenuRequest, TavoraSDK } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from "vue";
import AddInput from "./AddInput.vue";
import GroupSection, { type DropTarget } from "./GroupSection.vue";
import { plural, setLanguage, t } from "./i18n";
import { buildLiveState, LIVE_DEFAULTS, LIVE_RANGE, parseLook, throttle } from "./live";
import { collapse, LINGER_MS, PANEL, UNDO_MS, type FinishedMode } from "./panel";
import { createTodoStore, type TodoStore } from "./store";
import TaskRow from "./TaskRow.vue";
import { addGroup, addTask, childCount, deleteGroup, findTask, LIST_ID, MAX, moveTask, parseList, type Group, type TodoList } from "./todos";

const EMPTY = parseList(null);
const FINISHED_MODES: FinishedMode[] = ["stay", "vanish"];

interface PanelState {
  finished: FinishedMode;
  collapsed: string[];
  folded: string[];
  /** Live view: plate opacity in percent and padding in px. */
  liveBackground: number;
  livePadding: number;
}

const sdk = shallowRef<TavoraSDK | null>(null);
const store = shallowRef<TodoStore | null>(null);
const error = ref<string | null>(null);
const finished = ref<FinishedMode>("stay");
const collapsed = ref<string[]>([]);
const folded = ref<string[]>([]);
const liveBackground = ref(LIVE_DEFAULTS.background);
const livePadding = ref(LIVE_DEFAULTS.padding);
const editing = ref<string | null>(null);
const pendingGroup = shallowRef<Group | null>(null);
const dragging = ref<string | null>(null);
const drop = ref<DropTarget | null>(null);

const list = computed<TodoList>(() => store.value?.list.value ?? EMPTY);
const openTotal = computed(() => list.value.groups.reduce((sum, group) => sum + group.tasks.filter((task) => !task.done).length, 0));
const allCollapsed = computed(() => list.value.groups.length > 0 && list.value.groups.every((group) => collapsed.value.includes(group.id)));

// ── Finished to-dos stay a moment before they vanish ─────────────────

/** Just-finished to-dos, kept on screen; for each, whether it was an objective. */
const lingeringPinned = ref(new Map<string, boolean>());
const lingering = computed<ReadonlySet<string>>(() => new Set(lingeringPinned.value.keys()));
let lingerTimer: ReturnType<typeof setTimeout> | undefined;

function linger(taskId: string, wasPinned: boolean) {
  lingeringPinned.value = new Map(lingeringPinned.value).set(taskId, wasPinned);
  clearTimeout(lingerTimer);
  lingerTimer = setTimeout(() => (lingeringPinned.value = new Map()), LINGER_MS);
}

/** Pinned tasks, plus objectives finished a moment ago so they leave smoothly too. */
const objectives = computed(() =>
  list.value.groups.flatMap((group) =>
    group.tasks.filter((task) => task.pinned || lingeringPinned.value.get(task.id) === true).map((task) => ({ group, task })),
  ),
);

// ── Undo ─────────────────────────────────────────────────────────────

let undoToast: { dismiss: () => void } | null = null;

function offerUndo(message: string, run: () => void) {
  undoToast?.dismiss();
  undoToast = toast({ title: message, duration: UNDO_MS, testid: "undo-toast", actionTestid: "undo", action: { label: t("undo"), onClick: run } });
}

// ── Panel state ──────────────────────────────────────────────────────

function savePanel() {
  // Plain values only: a Vue proxy cannot be sent to the host.
  void sdk.value?.panel.setState({ finished: finished.value, collapsed: [...collapsed.value], folded: [...folded.value], liveBackground: liveBackground.value, livePadding: livePadding.value } satisfies PanelState);
}

function setLook(key: "liveBackground" | "livePadding", value: number | undefined) {
  if (value === undefined) return;
  (key === "liveBackground" ? liveBackground : livePadding).value = value;
  savePanel();
}

function resetLook() {
  liveBackground.value = LIVE_DEFAULTS.background;
  livePadding.value = LIVE_DEFAULTS.padding;
  savePanel();
}

// ── Live view: what Tavora shows over the game while this panel is closed ──

const sendLive = throttle((state: ReturnType<typeof buildLiveState>) => void sdk.value?.panel.setLive(state).catch(() => {}), 250);

watch(
  [() => list.value, collapsed, liveBackground, livePadding, sdk],
  () => {
    if (!sdk.value || !store.value) return;
    const look = parseLook({ background: liveBackground.value, padding: livePadding.value });
    sendLive(buildLiveState(list.value, collapsed.value, look, t("live.more", { count: "{count}" })));
  },
  { deep: true },
);

function setFinished(mode: FinishedMode) {
  finished.value = mode;
  savePanel();
}

function toggle(ids: typeof collapsed, id: string) {
  ids.value = ids.value.includes(id) ? ids.value.filter((item) => item !== id) : [...ids.value, id];
  savePanel();
}

const toggleCollapsed = (groupId: string) => toggle(collapsed, groupId);

function toggleAllGroups() {
  collapsed.value = allCollapsed.value ? [] : list.value.groups.map((group) => group.id);
  savePanel();
}

/** Before the panel is connected there is nothing to show a menu with. */
const showMenu = (request: MenuRequest) => sdk.value?.ui.showMenu(request) ?? Promise.resolve(null);
provide(PANEL, { finished, editing, folded, toggleFolded: (id) => toggle(folded, id), linger, lingering, offerUndo, showMenu });

const cleanup: (() => void)[] = [];

onMounted(async () => {
  try {
    const connected = await connectModule(setLanguage);
    const todos = createTodoStore(connected);
    const [state] = await Promise.all([connected.panel.getState<Partial<PanelState> & { hideDone?: boolean }>(), todos.load()]);
    const ids = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
    // Panels saved by the version before had a "hide finished" switch instead.
    finished.value = state?.finished === "vanish" || (state?.finished === undefined && state?.hideDone === true) ? "vanish" : "stay";
    collapsed.value = ids(state?.collapsed);
    folded.value = ids(state?.folded);
    const look = parseLook({ background: state?.liveBackground, padding: state?.livePadding });
    liveBackground.value = look.background;
    livePadding.value = look.padding;
    cleanup.push(connected.documents.onChange((change) => change.id === LIST_ID && void todos.reload()));
    sdk.value = connected;
    store.value = todos;
  } catch (reason) {
    error.value = errorMessage(reason);
  }
});

onBeforeUnmount(() => {
  cleanup.forEach((fn) => fn());
  clearTimeout(lingerTimer);
  sendLive.cancel();
  undoToast?.dismiss();
});

function createGroup(name: string) {
  const id = crypto.randomUUID();
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
  if (!taskId || !target || target.beforeId === taskId) return;
  void store.value!.apply((data) => moveTask(data, taskId, target.groupId, target.beforeId));
}
</script>

<template>
  <p v-if="!store" class="text-muted-foreground p-4 text-sm" data-testid="status">
    {{ error ? t("connectError", { error }) : t("loading") }}
  </p>
  <div v-else class="@container relative flex h-full min-h-0 flex-col" data-testid="todos-app">
    <header
      class="border-primary/25 bg-primary/5 flex h-10 flex-none items-center gap-1 border-b px-2"
      role="toolbar"
      :aria-label="t('app.toolbar')"
      data-testid="todos-toolbar"
    >
      <p :class="['min-w-0 flex-1 px-1 text-xs', !store.error.value && 'truncate']" :role="store.error.value ? 'alert' : 'status'" data-testid="todos-status">
        <span v-if="store.error.value" class="text-destructive">{{ store.error.value }}</span>
        <span v-else-if="list.groups.some((group) => group.tasks.length)" class="text-muted-foreground tabular-nums">
          {{ openTotal ? plural("app.open", openTotal) : t("app.allDone") }}
        </span>
      </p>
      <Button
        v-if="list.groups.length > 1"
        variant="ghost"
        size="icon-sm"
        :aria-label="allCollapsed ? t('app.expandAll') : t('app.collapseAll')"
        :title="allCollapsed ? t('app.expandAll') : t('app.collapseAll')"
        data-testid="toggle-groups"
        @click="toggleAllGroups"
      >
        <ChevronsUpDown v-if="allCollapsed" :stroke-width="1.5" />
        <ChevronsDownUp v-else :stroke-width="1.5" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <!-- In a small panel (over the game, say) only the icon stays, so the toolbar keeps its room for the count. -->
          <Button variant="ghost" size="sm" data-testid="finished-mode" :data-mode="finished" :aria-label="t(`app.finishedLabel.${finished}`)" :title="t(`app.finishedLabel.${finished}`)">
            <ListChecks :stroke-width="1.5" />
            <span class="hidden @min-[20rem]:inline">{{ t(`app.finishedLabel.${finished}`) }}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{{ t("app.finished") }}</DropdownMenuLabel>
          <DropdownMenuItem v-for="mode in FINISHED_MODES" :key="mode" :data-testid="`finished-${mode}`" @select="setFinished(mode)">
            {{ t(`app.finished.${mode}`) }}
            <Check v-if="finished === mode" class="ml-auto" :stroke-width="1.5" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover>
        <PopoverTrigger as-child>
          <Button variant="ghost" size="icon-sm" :aria-label="t('live.menu')" :title="t('live.menu')" data-testid="live-settings">
            <Eye :stroke-width="1.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" class="w-64" data-testid="live-popover">
          <p class="text-sm font-medium">{{ t("live.menu") }}</p>
          <div class="mt-3 flex items-center justify-between text-xs">
            <span>{{ t("live.background") }}</span>
            <span class="text-muted-foreground tabular-nums" data-testid="live-background-value">{{ liveBackground }}%</span>
          </div>
          <Slider
            :model-value="[liveBackground]"
            :min="LIVE_RANGE.background[0]"
            :max="LIVE_RANGE.background[1]"
            :step="1"
            class="mt-2"
            :aria-label="t('live.background')"
            data-testid="live-background"
            @update:model-value="setLook('liveBackground', $event?.[0])"
          />
          <div class="mt-4 flex items-center justify-between text-xs">
            <span>{{ t("live.padding") }}</span>
            <span class="text-muted-foreground tabular-nums" data-testid="live-padding-value">{{ livePadding }} px</span>
          </div>
          <Slider
            :model-value="[livePadding]"
            :min="LIVE_RANGE.padding[0]"
            :max="LIVE_RANGE.padding[1]"
            :step="1"
            class="mt-2"
            :aria-label="t('live.padding')"
            data-testid="live-padding"
            @update:model-value="setLook('livePadding', $event?.[0])"
          />
          <Button variant="ghost" size="sm" class="mt-3" data-testid="live-reset" @click="resetLook">{{ t("live.reset") }}</Button>
        </PopoverContent>
      </Popover>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-2" @dragend="dragEnd">
      <EmptyState v-if="!list.groups.length" class="border-0" :title="t('app.empty')" data-testid="empty">
        <template #action><AddInput class="w-full max-w-80" outlined :placeholder="t('app.addTodo')" :maxlength="MAX.title" data-testid="first-task" @add="firstTask" /></template>
      </EmptyState>

      <section v-if="objectives.length" class="mb-3" :aria-label="t('app.objectives')" data-testid="objectives">
        <h2 class="text-muted-foreground px-2 pt-1 pb-1 text-xs font-medium">{{ t("app.objectives") }}</h2>
        <TransitionGroup tag="ul" role="list" :css="false" @leave="collapse">
          <li v-for="{ task, group } in objectives" :key="task.id">
            <TaskRow
              :store="store"
              :task="task"
              :group="group"
              :groups="list.groups"
              :index="group.tasks.indexOf(task)"
              :depth="0"
              :children="childCount(group.tasks, task.id)"
              :drop="null"
              compact
            />
          </li>
        </TransitionGroup>
      </section>

      <div class="flex flex-col gap-2">
        <GroupSection
          v-for="(group, position) in list.groups"
          :key="group.id"
          :store="store"
          :group="group"
          :groups="list.groups"
          :position="position"
          :collapsed="collapsed.includes(group.id)"
          :dragging="dragging !== null"
          :drop="drop"
          @toggle-collapsed="toggleCollapsed(group.id)"
          @remove="askRemoveGroup(group)"
          @dragstart="dragStart"
          @dragend="dragEnd"
          @dragover="(target) => (drop = target)"
          @drop="dropTask"
        />
      </div>

      <!-- Always at the end of the list once there is a group. -->
      <AddInput
        v-if="list.groups.length"
        class="mt-2 rounded-lg border border-dashed"
        :placeholder="t('app.newGroup')"
        :label="t('app.newGroupLabel')"
        :maxlength="MAX.groupName"
        data-testid="group-name-new"
        @add="createGroup"
      />
    </div>

    <Toaster />

    <ConfirmDialog
      v-if="pendingGroup"
      :title="t('app.deleteGroupTitle', { name: pendingGroup.name })"
      :description="plural('app.deleteGroupMessage', pendingGroup.tasks.length)"
      :confirm="t('app.deleteGroupConfirm')"
      :cancel="t('cancel')"
      @confirm="removeGroup"
      @cancel="pendingGroup = null"
    />
  </div>
</template>
