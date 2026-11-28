<script setup lang="ts">
// To-Dos: a toolbar, current objectives, then the user's own groups. Every
// To-Dos panel of a workspace shows the same list; what is folded, hidden or being
// edited is each panel's own state.
import { ChevronsDownUp, ChevronsUpDown, Settings as SettingsIcon, Trash2 } from "@lucide/vue";
import { ConfirmDialog, connectModule, errorMessage, useFocusRecovery } from "@tavora/official-ui";
import { unknownFields } from "@tavora/official-ui/lib/utils";
import { leaveRow } from "@tavora/official-ui/components/ui/animated-list";
import { Button } from "@tavora/official-ui/components/ui/button";
import { liftedDragImage, useReorderMotion } from "@tavora/official-ui/components/ui/reorder";
import { settingsDialogSize } from "@tavora/official-ui/components/ui/module-settings";
import { SwitchField } from "@tavora/official-ui/components/ui/switch";
import { handleUndoKey, toast, Toaster, undoable, type Undoable, type UndoAnswer } from "@tavora/official-ui/components/ui/toast";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import { Toolbar } from "@tavora/official-ui/components/ui/toolbar";
import type { JsonValue, MenuOptions, TavoraSDK } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch, type ComponentPublicInstance } from "vue";
import AddInput from "./AddInput.vue";
import EditPlate from "./EditPlate.vue";
import GroupSection, { type DropTarget } from "./GroupSection.vue";
import { plural, setLanguage, t } from "./i18n";
import { de, en } from "./locales";
import { buildLiveState, fontStack, LIVE_DEFAULTS, PANEL_LOOK_DEFAULTS, PANEL_SIZES, parseLook, parsePanelLook, shownSize, throttle, withFinished, type LiveLook, type LiveState, type PanelLook } from "./live";
import { LINGER_MS, PANEL, ROW_FOCUS, type Draft, type FinishedMode } from "./panel";
import Settings from "./Settings.vue";
import { createTodoStore, type TodoStore } from "./store";
import TaskRow from "./TaskRow.vue";
import { addGroup, addTask, canRestoreGroup, childCount, deleteGroup, findTask, MAX, moveTask, parseList, removedGroup, restoreGroup, type Group, type TodoList } from "./todos";

const EMPTY = parseList(null);

interface PanelState {
  finished: FinishedMode;
  collapsed: string[];
  folded: string[];
  /** How the live view looks. Its `showFinished` mirrors `finished`, so a version before reads the same choice. */
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
/** The live view's look; its `showFinished` always says what `finished` does (withFinished). */
const look = shallowRef<LiveLook>(withFinished({ ...LIVE_DEFAULTS }, "stay"));
const panelLook = shallowRef<PanelLook>({ ...PANEL_LOOK_DEFAULTS });
/** When the settings last saved something, for the settings' "Saved". */
const savedAt = ref<number>();
/**
 * Where the panel is shown: in its slot, big as a dialog with its settings, or over the game (the in-game layer is open),
 * where it shows the live view's plate to edit in place (EditPlate). Opening a dialog over the game closes the layer.
 */
type Place = "slot" | "dialog" | "game";
const place = ref<Place>("slot");
/** Tavora says the panel came to `to` (true) or left it (false). */
function moved(to: Exclude<Place, "slot">, there: boolean) {
  if (there) place.value = to;
  else if (place.value === to) place.value = "slot";
}
const editing = ref<string | null>(null);
const draft = ref<Draft | null>(null);
/** The to-dos settle into their new places when one is dropped (they nest and cross groups, so they don't slide aside while it is held). */
const listEl = ref<HTMLElement | null>(null);
const reorder = useReorderMotion(listEl);
// A deleted group hands the focus to the next one (or the one before, or the empty list's field); so does an objective.
const groupsFocus = useFocusRecovery(listEl);
const objectivesEl = ref<ComponentPublicInstance | null>(null);
provide(ROW_FOCUS, useFocusRecovery(objectivesEl));
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

// Each change that can be put back (a to-do deleted or finished, a group deleted) gets its own toast with Undo, for
// a few seconds (undoable in the kit). Ctrl+Z takes back the newest one. Over the game there are none: a toast would
// pop up in the middle of the game, so a change made there just stays.
const offers = new Set<Undoable>();

function offerUndo(message: string, run: () => UndoAnswer) {
  if (place.value === "game") return;
  const offer = undoable({ title: message, undo: run, onFinal: () => offers.delete(offer) });
  offers.add(offer);
}

// ── Panel state ──────────────────────────────────────────────────────

/** What a newer version keeps in the panel's state besides, saved back with it so it is still there. */
let otherState: Record<string, JsonValue> = {};

function savePanel() {
  // Plain values only: a Vue proxy cannot be sent to the host.
  void sdk.value?.panel.setState({ ...otherState, finished: finished.value, collapsed: [...collapsed.value], folded: [...folded.value], live: { ...look.value }, panel: { ...panelLook.value } } satisfies PanelState);
}

function setLook(next: LiveLook) {
  // The Content page's Finished to-dos row is the toolbar's Keep finished to-dos: both write the same choice.
  finished.value = next.showFinished ? "stay" : "vanish";
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
  const [size, leading] = PANEL_SIZES[shownSize(panelLook.value.size)];
  return { "--todo-font": fontStack(panelLook.value.font), "--todo-text": `${size}px`, "--todo-leading": `${leading}px` };
});

/** Opens the settings: the panel shows them big, in a dialog over the app, as every module's settings. */
function openSettings() {
  void sdk.value?.panel.openDialog(settingsDialogSize({ pages: 4 })).catch((reason) => toast.error(t("settings.openError", { error: errorMessage(reason) })));
}

function onKey(event: KeyboardEvent) {
  // Outside text fields; what is being typed keeps its own Ctrl+Z.
  if (place.value !== "game" && handleUndoKey(event)) return;
  // Esc in an open list (a Select, say) closes only that.
  const inPopup = (event.target as Element | null)?.closest?.("[role=listbox], [role=menu], [role=dialog]");
  if (event.key === "Escape" && place.value === "dialog" && !event.defaultPrevented && !inPopup) void sdk.value?.panel.closeDialog();
}

// ── Live view: what Tavora shows over the game while this panel is closed ──

const liveState = computed<LiveState>(() => buildLiveState(list.value, collapsed.value, look.value, { more: t("live.more", { count: "{count}" }), objectives: t("app.objectives") }));
const sendLive = throttle((state: LiveState) => void sdk.value?.panel.setLive(state).catch(() => {}), 250);

watch([liveState, sdk], () => {
  if (sdk.value && store.value) sendLive(liveState.value);
});

// Over the game the page is see-through around the plate, and an editor or new to-do left open in the panel doesn't
// come along. The plate keeps a title being typed when the layer closes (EditPlate).
watch(
  () => place.value === "game",
  (over) => {
  if (over) {
    editing.value = null;
    draft.value = null;
  }
  document.documentElement.classList.toggle("over-game", over);
  },
);

/** The toolbar toggle: pressed keeps finished to-dos in the list and over the game, released lets them vanish. */
function toggleFinished() {
  const mode: FinishedMode = finished.value === "stay" ? "vanish" : "stay";
  finished.value = mode;
  look.value = withFinished(look.value, mode);
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
/** The panel went while it was still connecting: what arrives after that is closed again, not kept. */
let unmounted = false;

onMounted(async () => {
  try {
    const connection = await connectModule({ texts: { en, de } });
    if (connection.status !== "ready" || !connection.sdk) throw connection.error;
    const connected = connection.sdk;
    if (unmounted) {
      connection.dispose();
      return;
    }
    // The components read the module's own translator; it follows the language the handle reports.
    setLanguage(connection.language);
    cleanup.push(connection.onLanguage(setLanguage), connection.dispose);
    const [state, todos] = await Promise.all([connected.panel.getState<Partial<PanelState> & OldPanelState>(), createTodoStore(connected)]);
    if (unmounted) {
      void todos.dispose().catch(() => undefined);
      return;
    }
    otherState = unknownFields<JsonValue>(state, ["finished", "collapsed", "folded", "live", "panel", "hideDone", "liveBackground", "livePadding"]);
    const ids = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
    // Panels saved by the version before had a "hide finished" switch instead.
    finished.value = state?.finished === "vanish" || (state?.finished === undefined && state?.hideDone === true) ? "vanish" : "stay";
    collapsed.value = ids(state?.collapsed);
    folded.value = ids(state?.folded);
    // The look's own showFinished (kept on its own before) gives way to the panel's switch.
    look.value = withFinished(parseLook(state?.live ?? { background: state?.liveBackground, padding: state?.livePadding }), finished.value);
    panelLook.value = parsePanelLook(state?.panel);
    cleanup.push(connected.panel.onDialogChange((open) => moved("dialog", open)));
    // Hidden or closed right after a change: the live view over the game still gets it.
    cleanup.push(connected.lifecycle.onSuspend(sendLive.flush), connected.lifecycle.onDispose(sendLive.flush));
    // A page that (re)loads while over the game asks; a change while it runs comes as an event and wins over a late
    // answer. An older Tavora has neither and keeps the full panel there.
    let heardOverGame = false;
    cleanup.push(
      connected.panel.onOverGameChange((over) => {
        heardOverGame = true;
        moved("game", over);
      }),
    );
    if (connected.supports("panel.isOverGame"))
      void connected.panel
        .isOverGame()
        .then((over) => !heardOverGame && moved("game", over))
        .catch(() => {});
    addEventListener("keydown", onKey);
    cleanup.push(() => removeEventListener("keydown", onKey));
    cleanup.push(() => void todos.dispose().catch(() => undefined));
    sdk.value = connected;
    store.value = todos;
  } catch (reason) {
    error.value = errorMessage(reason);
  }
});

onBeforeUnmount(() => {
  unmounted = true;
  // Before the connection goes: the live view keeps showing the last change.
  sendLive.flush();
  cleanup.forEach((fn) => fn());
  clearTimeout(lingerTimer);
  // The panel goes: its offers end, and what was deleted stays deleted.
  for (const offer of offers) offer.close();
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

/** The group whose delete waits for a yes: one with to-dos goes for good, so it is asked first. */
const deletingGroup = ref<string | null>(null);
const askedGroup = computed(() => list.value.groups.find((group) => group.id === deletingGroup.value));
// Deleted or emptied by another panel meanwhile: the question goes, and doesn't come back with an Undo there.
watch(askedGroup, (group) => {
  if (!group?.tasks.length) deletingGroup.value = null;
});

/** Deletes a group: an empty one at once with Undo, one with to-dos after asking. */
function removeGroup(group: Group) {
  const todos = store.value!;
  if (group.tasks.length) {
    deletingGroup.value = group.id;
    return;
  }
  const removed = removedGroup(todos.list.value, group.id);
  if (!removed) return;
  todos.apply((data) => deleteGroup(data, group.id));
  offerUndo(t("app.groupDeleted", { name: group.name }), () => {
    // Checked on the list as it is now; the change itself may run again on a newer one (another panel saved first).
    if (!canRestoreGroup(todos.list.value, removed)) return false;
    todos.apply((data) => void restoreGroup(data, removed));
    groupsFocus.restore(group.id);
  });
}

function confirmRemoveGroup() {
  const group = askedGroup.value;
  deletingGroup.value = null;
  if (group) void store.value!.apply((data) => deleteGroup(data, group.id));
}

// ── Drag and drop ────────────────────────────────────────────────────

function dragStart(taskId: string, event: DragEvent) {
  dragging.value = taskId;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", findTask(list.value, taskId)?.task.title ?? "");
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-testid^='task-']");
    if (row) {
      event.dataTransfer.setDragImage(row, 16, 16);
      liftedDragImage(event, row);
    }
  }
  reorder.begin(taskId);
}

function clearDrag() {
  dragging.value = null;
  drop.value = null;
}

function dragEnd() {
  clearDrag();
  reorder.cancel();
}

function dropTask() {
  const taskId = dragging.value;
  const target = drop.value;
  clearDrag();
  if (!taskId || !target || target.beforeId === taskId) return reorder.cancel();
  void reorder.drop(() => store.value!.apply((data) => moveTask(data, taskId, target.groupId, target.beforeId)));
}
</script>

<template>
  <p v-if="!store" class="text-muted-foreground p-4 text-sm" data-testid="status">
    {{ error ? t("connectError", { error }) : t("loading") }}
  </p>
  <Settings v-else-if="place === 'dialog'" :look="look" :panel-look="panelLook" :state="liveState" :saved-at="savedAt" @update:look="setLook" @update:panel-look="setPanelLook" />
  <EditPlate v-else-if="place === 'game'" :store="store" :list="list" :collapsed="collapsed" :look="look" />
  <div v-else class="@container relative flex h-full min-h-0 flex-col" :style="panelStyle" data-testid="todos-app">
    <Toolbar variant="bar" :label="t('app.toolbar')" data-testid="todos-toolbar">
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
        <ChevronsUpDown v-if="allCollapsed" />
        <ChevronsDownUp v-else />
      </Button>
      <!-- A switch: on keeps finished to-dos in the list. In a small panel (over the game, say) only the switch stays, so the toolbar keeps its room for the count. -->
      <SwitchField
        :model-value="finished === 'stay'"
        :label="t('app.keepFinished')"
        placement="end"
        class="text-muted-foreground w-auto flex-none gap-2"
        :label-class="['hidden @min-[20rem]:inline', finished === 'stay' && 'text-foreground']"
        :title="t(finished === 'stay' ? 'app.keepFinished.on' : 'app.keepFinished.off')"
        :switch-attrs="{ 'data-testid': 'finished-mode', 'data-mode': finished }"
        @update:model-value="toggleFinished"
      />
      <Button variant="ghost" size="icon-sm" :aria-label="t('settings.title')" :title="t('settings.title')" data-testid="live-settings" @click="openSettings">
        <SettingsIcon />
      </Button>
    </Toolbar>

    <div ref="listEl" class="min-h-0 flex-1 overflow-y-auto p-2" @dragend="dragEnd">
      <EmptyState v-if="!list.groups.length" variant="bare" :title="t('app.empty')" data-testid="empty" data-focus-empty>
        <template #action><AddInput class="w-full max-w-80" outlined :placeholder="t('app.addTodo')" :maxlength="MAX.title" data-testid="first-task" @add="firstTask" /></template>
      </EmptyState>

      <section v-if="objectives.length" class="mb-3" :aria-label="t('app.objectives')" data-testid="objectives" data-focus-row="objectives">
        <h2 class="text-muted-foreground px-2 pt-1 pb-1 text-xs font-medium">{{ t("app.objectives") }}</h2>
        <TransitionGroup ref="objectivesEl" tag="ul" role="list" :css="false" @leave="leaveRow">
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
          @remove="removeGroup(group)"
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
  </div>
  <ConfirmDialog
    v-if="askedGroup"
    :icon="Trash2"
    :confirm-icon="Trash2"
    :title="t('delete.title', { name: askedGroup.name })"
    :description="plural('delete.description', askedGroup.tasks.length)"
    :confirm="t('delete.confirm')"
    @confirm="confirmRemoveGroup"
    @cancel="deletingGroup = null"
  />
  <!-- Outside the views, so Undo toasts show in the settings too; never over the game. -->
  <Toaster v-if="place !== 'game'" />
</template>
