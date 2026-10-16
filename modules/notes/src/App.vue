<script setup lang="ts">
// Notes: a list and an editor side by side, or one at a time when the panel
// is narrow. Every Notes panel of a game shows the same notes; which note a
// panel shows is that panel's own state.
import { connectModule, errorMessage } from "@tavora/official-ui";
import type { TavoraSDK } from "@tavora/sdk";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import NoteEditor from "./NoteEditor.vue";
import NoteList from "./NoteList.vue";
import UndoToast from "./UndoToast.vue";
import { setLanguage, t } from "./i18n";
import { emptyContent, nudged, ORDER_ID, reordered, SCRATCHPAD_ID, sections, UNTITLED, type NoteEntry } from "./notes";
import { createNotesStore, type NotesStore } from "./store";

/** Below this width the list and the editor take turns. */
const NARROW_PX = 560;
/** The sidebar can be dragged between these widths; collapsed it is a strip of icons. */
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 340;
const SIDEBAR_DEFAULT = 240;
const SIDEBAR_STEP = 16;
const RAIL_PX = 40;

const clampSidebar = (value: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(value)));

const sdk = shallowRef<TavoraSDK | null>(null);
const store = shallowRef<NotesStore | null>(null);
const error = ref<string | null>(null);
const selectedId = ref(SCRATCHPAD_ID);
const sidebarWidth = ref(SIDEBAR_DEFAULT);
const collapsed = ref(false);
const query = ref("");
const width = ref(window.innerWidth);
const narrow = computed(() => width.value < NARROW_PX);
/** In a narrow panel: whether the list or the editor is showing. */
const showList = ref(false);
/** The last delete or clear, which the player can still undo for a few seconds. */
const undo = ref<{ id: number; message: string; run: () => Promise<void> } | null>(null);
let undoCount = 0;
const editor = ref<InstanceType<typeof NoteEditor> | null>(null);
/** A note made with New note that has no text yet; it is dropped if left empty. */
let freshId: string | null = null;

const entries = computed(() => store.value?.entries.value ?? new Map<string, NoteEntry>());
const selected = computed(() => entries.value.get(selectedId.value));
const order = computed(() => store.value?.order.value ?? []);
/** The scratchpad as the list shows it before anything has been saved to it. */
const scratchpadEntry = computed(() => sections(entries.value.values()).scratchpad);

/** What a panel remembers for itself: its note and how its sidebar looks. */
interface PanelState {
  selected?: string;
  sidebarWidth?: number;
  collapsed?: boolean;
}

function saveLayout() {
  void sdk.value?.panel.setState({ selected: selectedId.value, sidebarWidth: sidebarWidth.value, collapsed: collapsed.value } satisfies PanelState);
}

function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  saveLayout();
}

// Dragging the edge of the sidebar. The handle can also be moved with the arrow keys.
let dragStart: { x: number; width: number } | null = null;

function onResizeStart(event: PointerEvent) {
  dragStart = { x: event.clientX, width: sidebarWidth.value };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onResizeMove(event: PointerEvent) {
  if (dragStart) sidebarWidth.value = clampSidebar(dragStart.width + event.clientX - dragStart.x);
}

function onResizeEnd() {
  if (!dragStart) return;
  dragStart = null;
  saveLayout();
}

function onResizeKey(event: KeyboardEvent) {
  const step = event.key === "ArrowLeft" ? -SIDEBAR_STEP : event.key === "ArrowRight" ? SIDEBAR_STEP : 0;
  if (!step) return;
  event.preventDefault();
  sidebarWidth.value = clampSidebar(sidebarWidth.value + step);
  saveLayout();
}

function resetSidebarWidth() {
  sidebarWidth.value = SIDEBAR_DEFAULT;
  saveLayout();
}

const cleanup: (() => void)[] = [];
const onResize = () => (width.value = window.innerWidth);
const flushNow = () => void editor.value?.flush();

onMounted(async () => {
  addEventListener("resize", onResize);
  addEventListener("pagehide", flushNow);
  cleanup.push(() => removeEventListener("resize", onResize), () => removeEventListener("pagehide", flushNow));
  try {
    const connected = await connectModule(setLanguage);
    const notes = createNotesStore(connected);
    const [state] = await Promise.all([connected.panel.getState<PanelState>(), notes.load(), notes.loadAppearance()]);
    const saved = state?.selected;
    if (typeof saved === "string" && notes.entries.value.has(saved)) selectedId.value = saved;
    if (typeof state?.sidebarWidth === "number" && Number.isFinite(state.sidebarWidth)) sidebarWidth.value = clampSidebar(state.sidebarWidth);
    collapsed.value = state?.collapsed === true;
    cleanup.push(
      connected.documents.onChange((change) => void onOtherPanel(change.id, change.deleted)),
      connected.lifecycle.onSuspend(flushNow),
      connected.lifecycle.onDispose(flushNow),
    );
    sdk.value = connected;
    store.value = notes;
  } catch (reason) {
    error.value = errorMessage(reason);
  }
});

onBeforeUnmount(() => cleanup.forEach((fn) => fn()));

async function onOtherPanel(id: string, deleted: boolean) {
  const notes = store.value!;
  if (id === ORDER_ID) {
    await notes.refresh(id);
    return;
  }
  if (deleted) {
    notes.forget(id);
    if (id === selectedId.value) {
      editor.value?.discard();
      await select(SCRATCHPAD_ID);
    }
    return;
  }
  await notes.refresh(id);
  if (id === selectedId.value) await editor.value?.reloadFromOtherPanel();
}

async function select(id: string) {
  if (narrow.value) showList.value = false;
  if (id === selectedId.value) return;
  await editor.value?.flush();
  const fresh = freshId;
  if (fresh && fresh !== id) {
    freshId = null;
    const entry = store.value!.entries.value.get(fresh);
    if (entry && !entry.text.trim()) await store.value!.remove(fresh).catch(() => undefined);
  }
  selectedId.value = id;
  saveLayout();
}

async function rename(id: string, title: string) {
  await store.value!.save(id, { title }).catch(() => undefined);
}

/** Moves the scratchpad's text into a note of its own and leaves the scratchpad empty. */
async function saveAsNote() {
  const notes = store.value!;
  await editor.value?.flush();
  const { data } = await notes.open(SCRATCHPAD_ID);
  if (!data.text.trim()) return;
  const id = await notes.create({ content: data.content, text: data.text });
  await notes.saveContent(SCRATCHPAD_ID, emptyContent(), "");
  await select(id);
}

async function create() {
  query.value = "";
  const id = await store.value!.create();
  await select(id);
  freshId = id;
  await nextTick();
  await editor.value?.focus();
}

async function togglePin(id: string) {
  const entry = entries.value.get(id);
  if (entry) await store.value!.setPinned(id, !entry.pinned);
}

function offerUndo(message: string, run: () => Promise<void>) {
  undo.value = { id: ++undoCount, message, run };
}

async function runUndo() {
  const offer = undo.value;
  undo.value = null;
  await offer?.run().catch(() => undefined);
}

/** Deletes a note, or clears the scratchpad, at once; the player can undo it for a few seconds. */
async function removeNote(entry: NoteEntry) {
  const notes = store.value!;
  const open = entry.id === selectedId.value;
  // What is typed but not yet saved belongs in the copy that Undo brings back.
  if (open) await editor.value?.flush();
  const before = (await notes.open(entry.id)).data;
  if (open) editor.value?.discard();
  if (entry.id === SCRATCHPAD_ID) {
    await notes.saveContent(SCRATCHPAD_ID, emptyContent(), "");
    if (open) await editor.value?.reload();
    offerUndo(t("undo.cleared"), async () => {
      await notes.saveContent(SCRATCHPAD_ID, before.content, before.text);
      if (selectedId.value === SCRATCHPAD_ID) await editor.value?.reload();
    });
    return;
  }
  await notes.remove(entry.id);
  if (freshId === entry.id) freshId = null;
  if (open) await select(SCRATCHPAD_ID);
  const title = entry.title === UNTITLED ? t("untitled") : entry.title;
  offerUndo(t("undo.deleted", { title }), async () => {
    await notes.restore(entry.id, before);
    await select(entry.id);
  });
}

async function reorder(id: string, target: string, after: boolean) {
  const next = reordered(entries.value.values(), order.value, id, target, after);
  if (next) await store.value!.setOrder(next).catch(() => undefined);
}

async function move(id: string, delta: -1 | 1) {
  const next = nudged(entries.value.values(), order.value, id, delta);
  if (next) await store.value!.setOrder(next).catch(() => undefined);
}
</script>

<template>
  <p v-if="!store" class="text-muted-foreground p-4 text-sm" data-testid="status">
    {{ error ? t("connectError", { error }) : t("loading") }}
  </p>
  <div v-else class="flex h-full min-h-0" data-testid="notes-app" :data-narrow="narrow">
    <aside
      v-show="!narrow || showList"
      :class="narrow ? 'w-full' : 'relative flex-none border-r'"
      :style="narrow ? undefined : { width: `${collapsed ? RAIL_PX : sidebarWidth}px` }"
      class="bg-card h-full min-w-0"
      data-testid="sidebar"
      :data-collapsed="collapsed && !narrow"
    >
      <NoteList
        v-model:query="query"
        :entries="entries"
        :order="order"
        :selected-id="selectedId"
        :collapsed="collapsed"
        :narrow="narrow"
        @select="select"
        @create="create"
        @toggle-pin="togglePin"
        @remove="removeNote"
        @rename="rename"
        @reorder="reorder"
        @move="move"
        @toggle-collapsed="toggleCollapsed"
      />
      <div
        v-if="!narrow && !collapsed"
        class="hover:bg-primary/40 focus-visible:bg-primary/60 absolute inset-y-0 -right-[3px] z-10 w-1.5 cursor-col-resize touch-none outline-none"
        role="separator"
        aria-orientation="vertical"
        tabindex="0"
        data-testid="sidebar-resize"
        :aria-label="t('list.resize')"
        :aria-valuenow="sidebarWidth"
        :aria-valuemin="SIDEBAR_MIN"
        :aria-valuemax="SIDEBAR_MAX"
        @pointerdown.prevent="onResizeStart"
        @pointermove="onResizeMove"
        @pointerup="onResizeEnd"
        @pointercancel="onResizeEnd"
        @keydown="onResizeKey"
        @dblclick="resetSidebarWidth"
      />
    </aside>
    <main v-show="!narrow || !showList" class="h-full min-w-0 flex-1">
      <NoteEditor
        ref="editor"
        :store="store"
        :note-id="selectedId"
        :entry="selected"
        :narrow="narrow"
        :look="selectedId === SCRATCHPAD_ID ? store.appearance.value.scratchpad : store.appearance.value.notes"
        @set-style="(patch) => store!.setStyle(selectedId === SCRATCHPAD_ID ? 'scratchpad' : 'notes', patch)"
        @back="showList = true"
        @toggle-pin="togglePin(selectedId)"
        @clear="removeNote(entries.get(SCRATCHPAD_ID) ?? scratchpadEntry)"
        @save-as-note="saveAsNote"
      />
    </main>
    <UndoToast v-if="undo" :key="undo.id" :message="undo.message" @undo="runUndo" @dismiss="undo = null" />
  </div>
</template>
