<script setup lang="ts">
// To-Dos: a toolbar, current objectives, then the user's own groups. Every
// To-Dos panel of a workspace shows the same list; what is folded, hidden or being
// edited is each panel's own state.
import { ChevronsDownUp, ChevronsUpDown, Settings as SettingsIcon } from "@lucide/vue";
import { ConfirmDialog, connectModule, errorMessage } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { Toaster, toast } from "@tavora/official-ui/components/ui/toast";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import type { MenuOptions, TavoraSDK } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from "vue";
import AddInput from "./AddInput.vue";
import GroupSection, { type DropTarget } from "./GroupSection.vue";
import { plural, setLanguage, t } from "./i18n";
import { buildLiveState, fontStack, LIVE_DEFAULTS, PANEL_LOOK_DEFAULTS, PANEL_SIZES, parseLook, parsePanelLook, throttle, type LiveLook, type LiveState, type PanelLook } from "./live";
import { collapse, LINGER_MS, PANEL, UNDO_MS, type Draft, type FinishedMode } from "./panel";
import Settings from "./Settings.vue";
import { createTodoStore, type TodoStore } from "./store";
import TaskRow from "./TaskRow.vue";
import { addGroup, addTask, childCount, deleteGroup, findTask, LIST_ID, MAX, moveTask, parseList, type Group, type TodoList } from "./todos";

const EMPTY = parseList(null);

interface PanelState {
  finished: FinishedMode;
  collapsed: string[];
  folded: string[];
  /** How the live view looks. */
  live: LiveLook;
  /** How this panel shows to-dos. */
  panel: PanelLook;
}

/** What versions before kept instead of `finished` and `live`. */
interface OldPanelState {
  hideDone?: boolean;
  liveBackground?: number;
  livePadding?: number;
}

const sdk = shallowRef<TavoraSDK | null>(null);
const store = shallowRef<TodoStore | null>(null);
const error = ref<string | null>(null);
const finished = ref<FinishedMode>("stay");
const collapsed = ref<string[]>([]);
const folded = ref<string[]>([]);
const look = shallowRef<LiveLook>({ ...LIVE_DEFAULTS });
const panelLook = shallowRef<PanelLook>({ ...PANEL_LOOK_DEFAULTS });
/** When the settings last saved something, for the settings' "Saved". */
const savedAt = ref<number>();
/** The panel is shown big as a dialog, with its settings. */
const dialogOpen = ref(false);
const editing = ref<string | null>(null);
const draft = ref<Draft | null>(null);
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
  void sdk.value?.panel.setState({ finished: finished.value, collapsed: [...collapsed.value], folded: [...folded.value], live: { ...look.value }, panel: { ...panelLook.value } } satisfies PanelState);
}

function setLook(next: LiveLook) {
  look.value = next;
  savePanel();
  savedAt.value = Date.now();
}

function setPanelLook(next: PanelLook) {
  panelLook.value = next;
  savePanel();
  savedAt.value = Date.now();
}

/** The font and text size the panel shows to-dos in (TaskRow reads them). */
const panelStyle = computed(() => {
  const [size, leading] = PANEL_SIZES[panelLook.value.size];
  return { "--todo-font": fontStack(panelLook.value.font), "--todo-text": `${size}px`, "--todo-leading": `${leading}px` };
});

/** Opens the settings: the panel shows them big, in a dialog over the app, as every module's settings. */
function openSettings() {
  void sdk.value?.panel.openDialog({ width: 960, height: 680 }).catch((reason) => (error.value = errorMessage(reason)));
}

function onKey(event: KeyboardEvent) {
  // Esc in an open list (a Select, say) closes only that.
  const inPopup = (event.target as Element | null)?.closest?.("[role=listbox], [role=menu], [role=dialog]");
  if (event.key === "Escape" && dialogOpen.value && !event.defaultPrevented && !inPopup) void sdk.value?.panel.closeDialog();
}

// ── Live view: what Tavora shows over the game while this panel is closed ──

const liveState = computed<LiveState>(() => buildLiveState(list.value, collapsed.value, look.value, { more: t("live.more", { count: "{count}" }), objectives: t("app.objectives") }));
const sendLive = throttle((state: LiveState) => void sdk.value?.panel.setLive(state).catch(() => {}), 250);

watch([liveState, sdk], () => {
  if (sdk.value && store.value) sendLive(liveState.value);
});

/** The toolbar toggle: pressed keeps finished to-dos in the list, released lets them vanish. */
function toggleFinished() {
  const mode: FinishedMode = finished.value === "stay" ? "vanish" : "stay";
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
const showMenu = (request: MenuOptions) => sdk.value?.ui.showMenu(request) ?? Promise.resolve(null);
provide(PANEL, { finished, editing, draft, folded, toggleFolded: (id) => toggle(folded, id), linger, lingering, offerUndo, showMenu });

const cleanup: (() => void)[] = [];

onMounted(async () => {
  try {
    const connected = await connectModule(setLanguage);
    const todos = createTodoStore(connected);
    const [state] = await Promise.all([connected.panel.getState<Partial<PanelState> & OldPanelState>(), todos.load()]);
    const ids = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
    // Panels saved by the version before had a "hide finished" switch instead.
    finished.value = state?.finished === "vanish" || (state?.finished === undefined && state?.hideDone === true) ? "vanish" : "stay";
    collapsed.value = ids(state?.collapsed);
    folded.value = ids(state?.folded);
    look.value = parseLook(state?.live ?? { background: state?.liveBackground, padding: state?.livePadding });
    panelLook.value = parsePanelLook(state?.panel);
    cleanup.push(connected.panel.onDialogChange((open) => (dialogOpen.value = open)));
    addEventListener("keydown", onKey);
    cleanup.push(() => removeEventListener("keydown", onKey));
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
  // Made here, not in the change: a change runs again on the stored list, and the group must keep its id.
  const groupId = crypto.randomUUID();
  void store.value!.apply((data) => addTask(data, null, { id, title: text, createdAt }, groupId));
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
  <Settings v-else-if="dialogOpen" :look="look" :panel-look="panelLook" :state="liveState" :saved-at="savedAt" @update:look="setLook" @update:panel-look="setPanelLook" />
  <div v-else class="@container relative flex h-full min-h-0 flex-col" :style="panelStyle" data-testid="todos-app">
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
      <!-- A switch: on keeps finished to-dos in the list. In a small panel (over the game, say) only the switch stays, so the toolbar keeps its room for the count. -->
      <label class="text-muted-foreground flex h-8 flex-none cursor-pointer items-center gap-2 rounded-md px-2 text-sm" :title="t(finished === 'stay' ? 'app.keepFinished.on' : 'app.keepFinished.off')">
        <span :class="['hidden @min-[20rem]:inline', finished === 'stay' && 'text-foreground']">{{ t("app.keepFinished") }}</span>
        <Switch :model-value="finished === 'stay'" :aria-label="t('app.keepFinished')" data-testid="finished-mode" :data-mode="finished" @update:model-value="toggleFinished" />
      </label>
      <Button variant="ghost" size="icon-sm" :aria-label="t('settings.title')" :title="t('settings.title')" data-testid="live-settings" @click="openSettings">
        <SettingsIcon :stroke-width="1.5" />
      </Button>
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
  <!-- Outside the views, so Undo toasts show in the settings too. -->
  <Toaster />
</template>
