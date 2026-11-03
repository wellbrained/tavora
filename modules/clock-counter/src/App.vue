<script setup lang="ts">
// Clock & Counter: a toolbar with Add, then the workspace's clocks and counters. Every panel of a workspace shows the same
// list; which settings are open is each panel's own. Running clocks tick here only while the panel is visible: they
// keep their start time, so nothing is lost while it is hidden. Hotkeys arrive at the panel used last.
import { Hash, Hourglass, Link, Plus, Timer } from "@lucide/vue";
import { connectModule, errorMessage } from "@tavora/official-ui";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { settingsDialogSize } from "@tavora/official-ui/components/ui/module-settings";
import { Toaster, toast } from "@tavora/official-ui/components/ui/toast";
import { liftedDragImage, reducedMotion, useReorderMotion } from "@tavora/official-ui/components/ui/reorder";
import type { TavoraSDK } from "@tavora/sdk";
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from "vue";
import { plural, setLanguage, t } from "./i18n";
import { ACTIVE_GROUP, ROW_FADE } from "./active";
import ItemCard from "./ItemCard.vue";
import ItemEditor from "./ItemEditor.vue";
import SettingsSkeleton from "./SettingsSkeleton.vue";
import { count, find, groupOf, insert, lap, linkedGroups, MAX, move, moveTo, newItem, parseList, remove, resetClock, resetCounter, startPause, visualOrder, type Counter, type Item, type ItemKind, type ItemList } from "./items";
import { buildLiveState } from "./live";
import { de, en } from "./locales";
import { PANEL, UNDO_MS } from "./panel";
import { buildSources, canvasMeasure, itemForKey, overlayKey } from "./sources";
import { createItemStore, type ItemStore } from "./store";

const EMPTY = parseList(null);
const KINDS: ItemKind[] = ["countdown", "stopwatch", "counter"];
/** The same icons as the rows in the list, so the Add menu shows what each one becomes. */
const KIND_ICONS = { countdown: Hourglass, stopwatch: Timer, counter: Hash } as const;

const sdk = shallowRef<TavoraSDK | null>(null);
const store = shallowRef<ItemStore | null>(null);
const error = ref<string | null>(null);
/** A short hint in the toolbar (a settings dialog that would not open); it goes by itself. */
const notice = ref<string | null>(null);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
const editing = ref<string | null>(null);
/** This panel is shown as a dialog over the workspace; its page is then the settings of the item being edited. */
const dialogOpen = ref(false);
/** The page the settings open on (the gear: the item's own; a frame's Settings on the Overlay page: the overlay text), and a count so the same page opens again. */
const startPage = ref<"item" | "text">("item");
const startCount = ref(0);
/** The overlay a frame's Settings press asked for, until the list is there to find its item in. */
const pendingKey = ref<string | null>(null);
const editedItem = computed(() => (editing.value ? find(list.value, editing.value) : undefined));
const now = ref(Date.now());
const hotkeys = ref<ReadonlySet<string>>(new Set());
const suspended = ref(false);

const list = computed<ItemList>(() => store.value?.list.value ?? EMPTY);
const running = computed(() => list.value.items.some((item) => item.kind !== "counter" && item.since !== null));

// ── What the panel shows: counters joined by links stand together in one frame ──

type Row = { type: "item"; item: Item } | { type: "group"; key: string; items: Counter[] };

const order = computed(() => visualOrder(list.value));
const rows = computed<Row[]>(() => {
  const groups = linkedGroups(list.value);
  const done = new Set<string>();
  const result: Row[] = [];
  for (const item of order.value) {
    if (done.has(item.id)) continue;
    const group = groups.find((one) => one.members.some((member) => member.id === item.id));
    if (group) {
      group.members.forEach((member) => done.add(member.id));
      result.push({ type: "group", key: group.key, items: group.members });
    } else result.push({ type: "item", item });
  }
  return result;
});
/** What a row is called for the drag: an item's own id, or its first counter's for a linked group. */
const rowId = (row: Row) => (row.type === "item" ? row.item.id : row.items[0]!.id);

/** The overlay an item's OBS link belongs to: the group's, once the group is shown as a whole. */
function keyOf(item: Item): string {
  return overlayKey(list.value, item);
}

// ── The time now, while a clock runs and the panel shows ─────────────

let ticker: ReturnType<typeof setInterval> | undefined;
watch(
  [running, suspended],
  ([on, hidden]) => {
    clearInterval(ticker);
    now.value = Date.now();
    if (on && !hidden) ticker = setInterval(() => (now.value = Date.now()), 250);
  },
  { immediate: true },
);

// ── Actions, from a button or a hotkey ───────────────────────────────

/** The items an action on `id` changes: the item, and for a counter the counters it adds to. */
function touchedBy(id: string): string[] {
  const item = find(list.value, id);
  return item?.kind === "counter" ? [id, ...item.links.map((link) => link.target)] : [id];
}

function act(action: string, id: string): void {
  const at = Date.now();
  void store.value?.apply(touchedBy(id), (data) => {
    const item = find(data, id);
    if (!item) return;
    if (item.kind === "counter") {
      if (action === "up") count(data, id, 1);
      else if (action === "down") count(data, id, -1);
      else if (action === "reset") resetCounter(item);
    } else if (action === "start-pause") startPause(item, at);
    else if (action === "reset") resetClock(item);
    else if (action === "lap") lap(item, at);
  });
}

/** Opens an item's settings (or closes them); from the gear's click, which Tavora needs to show the dialog. */
function toggleEdit(id: string): void {
  if (editing.value === id) {
    closeEditing();
    return;
  }
  openEditing(id);
}

/** Tells the user something short in the toolbar for a few seconds. */
function say(text: string): void {
  notice.value = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = null), UNDO_MS);
}

function openEditing(id: string): void {
  editing.value = id;
  startPage.value = "item";
  startCount.value++;
  // Over the game this closes the game layer and opens the dialog in Tavora, so it is no different from the workspace.
  // An item's settings always have several pages (its own, Text, Look and the overlays), so this is the usual 960 × 680.
  sdk.value!.panel.openDialog(settingsDialogSize({ pages: 2 })).catch(() => {
    editing.value = null;
    say(t("app.settingsFailed"));
  });
}

function closeEditing(): void {
  editing.value = null;
  if (dialogOpen.value) void sdk.value?.panel.closeDialog();
}

// The item is gone (deleted here or in another panel): its settings have nothing to show.
watch(editedItem, (item) => {
  if (!item && editing.value) closeEditing();
});

function onKey(event: KeyboardEvent): void {
  // Esc in an open list (a Select, say) closes only that.
  const inPopup = (event.target as Element | null)?.closest?.("[role=listbox], [role=menu], [role=dialog]");
  if (event.key === "Escape" && dialogOpen.value && !event.defaultPrevented && !inPopup) closeEditing();
}

/** Adds an item. `settings` opens its settings to name it, which needs the click on the Add button itself. */
function addItem(kind: ItemKind, settings = true): void {
  const id = crypto.randomUUID();
  const same = list.value.items.filter((item) => item.kind === kind).length;
  const label = same ? `${t(`kind.${kind}`)} ${same + 1}` : t(`kind.${kind}`);
  void store.value?.apply([id], (data) => insert(data, newItem(kind, id, label)));
  // Its settings open too, to name it. From the menu they stay closed: the item is in the list, the gear opens them.
  if (settings) openEditing(id);
}

// ── Order: drag a row, Move up and Move down in its menu, or Alt+Up and Alt+Down on one of its buttons ───

// The rows slide aside for the dragged one and settle into place when it is dropped; Alt+arrows move them at once.
const listEl = ref<HTMLElement | null>(null);
/** The panel's scroller: it holds the focus when the last row is deleted. */
const scroller = ref<HTMLElement | null>(null);
const reorder = useReorderMotion(listEl);
const dragId = ref<string | null>(null);
const drop = ref<{ id: string; after: boolean } | null>(null);

function onDragStart(event: DragEvent, id: string): void {
  dragId.value = id;
  reorder.begin(id);
  if (event.currentTarget instanceof HTMLElement) liftedDragImage(event, event.currentTarget);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }
}

/**
 * Over the list the place comes from the pointer and the layout at the grab, not from the row under the pointer: the rows
 * slide aside as the gap opens, and a row that slid under the pointer would ask for the swap back, over and over.
 */
function onDragOver(event: DragEvent): void {
  if (!dragId.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  drop.value = reorder.over(event.clientX, event.clientY);
}

function onDrop(event: DragEvent): void {
  event.preventDefault();
  if (!dragId.value) return;
  const from = dragId.value;
  const place = drop.value;
  clearDrag();
  if (from && place) void reorder.drop(() => void store.value?.apply([], (data) => moveTo(data, from, place.id, place.after)));
  else reorder.cancel();
}

function clearDrag(): void {
  dragId.value = null;
  drop.value = null;
}

function endDrag(): void {
  clearDrag();
  reorder.cancel();
}

/** The line where a row would land, for reduced motion; otherwise the gap that opens is the place. */
function dropLine(row: Row): string | false {
  if (!reducedMotion()) return false;
  return drop.value?.id === rowId(row) && (drop.value.after ? "shadow-[0_2px_0_0_var(--primary)]" : "shadow-[0_-2px_0_0_var(--primary)]");
}

/** Moves a row one place, at once (a key or the menu never animates). */
async function moveRow(id: string, by: -1 | 1, focus: string): Promise<void> {
  void store.value?.apply([], (data) => move(data, id, by));
  // The row is moved in the list, which drops the keyboard focus; give it back.
  await nextTick();
  setTimeout(() => document.querySelector<HTMLElement>(focus)?.focus(), 60);
}

function onRowKey(event: KeyboardEvent): void {
  if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
  const card = (event.target as Element | null)?.closest<HTMLElement>('article[data-testid^="item-"]');
  const id = card?.dataset.testid?.slice("item-".length);
  if (!id) return;
  event.preventDefault();
  void moveRow(id, event.key === "ArrowUp" ? -1 : 1, `[data-testid="item-${id}"] button`);
}

// ── The frame of the dialog names what the settings are about ───────

/**
 * Whether Tavora shows the item's name in the frame of the dialog: null until it has answered, false on an older Tavora, which
 * keeps the module's name there, so the page names the item itself. (Tried rather than asked with `supports`, which goes by the
 * version number.)
 */
const titled = ref<boolean | null>(null);
/** What the settings are of, as the frame says it: the item's label and its type ("Plank timer · Stopwatch"); "Group" once its overlay is its group's. */
const dialogTitle = computed(() => {
  const item = editedItem.value;
  if (!item) return null;
  const label = item.label || t(`kind.${item.kind}`);
  const kind = t(`kind.${kindTag(item)}`);
  // A clock still called "Stopwatch" says what it is already.
  return label.toLowerCase() === kind.toLowerCase() ? label : t("edit.title", { label, kind });
});
function kindTag(item: Item): ItemKind | "group" {
  return item.kind === "counter" && keyOf(item) !== item.id ? "group" : item.kind;
}
watch(
  [dialogOpen, dialogTitle],
  ([open, title]) => {
    if (!open || titled.value === false) return;
    sdk.value?.panel.setDialogTitle(title).then(
      () => (titled.value = true),
      (reason: { code?: string }) => {
        if (reason?.code === "UNKNOWN_METHOD") titled.value = false;
      },
    );
  },
  { immediate: true },
);

// ── Delete, with Undo ────────────────────────────────────────────────

// The offer keeps its own time, so the hotkeys go when it ends even if its toast was closed early.
const undo = shallowRef<{ item: Item; index: number; timer: ReturnType<typeof setTimeout>; toast: { dismiss: () => void } } | null>(null);

/** The undo time ran out: the item's hotkeys go too. */
function forget(item: Item): void {
  void sdk.value?.hotkeys.remove(item.id).then(refreshHotkeys, () => undefined);
}

function removeItem(item: Item): void {
  // The focus goes to the next row's ··· button (or the one before), or to the list when it was the last one.
  const at = order.value.findIndex((other) => other.id === item.id);
  const neighbour = order.value[at + 1] ?? order.value[at - 1];
  const index = list.value.items.findIndex((other) => other.id === item.id);
  if (undo.value) {
    clearTimeout(undo.value.timer);
    undo.value.toast.dismiss();
    forget(undo.value.item);
  }
  // Counters linked to it lose the link; Undo brings back the item, not their links. Its group hears of it too.
  const group = item.kind === "counter" ? groupOf(list.value, item.id) : null;
  void store.value?.apply([item.id, ...(group?.members.map((member) => member.id) ?? [])], (data) => remove(data, item.id));
  void hideOverGame(item.id).catch(() => undefined);
  if (editing.value === item.id) closeEditing();
  // The row is gone and the menu that held the focus closes: give it back once both have happened.
  setTimeout(() => (neighbour ? document.querySelector<HTMLElement>(`[data-testid="more-${neighbour.id}"]`) : scroller.value)?.focus(), 60);
  const shown = toast({
    title: t("app.deleted", { label: item.label || t(`kind.${item.kind}`) }),
    duration: UNDO_MS,
    testid: "undo-toast",
    actionTestid: "undo",
    action: { label: t("undo"), onClick: runUndo },
  });
  undo.value = { item: structuredClone(item), index, timer: setTimeout(() => dismissUndo(), UNDO_MS), toast: shown };
}

function dismissUndo(): void {
  const offer = undo.value;
  undo.value = null;
  if (offer) {
    clearTimeout(offer.timer);
    offer.toast.dismiss();
    forget(offer.item);
  }
}

function runUndo(): void {
  const offer = undo.value;
  undo.value = null;
  if (!offer) return;
  clearTimeout(offer.timer);
  offer.toast.dismiss();
  // Back with the same id, so its OBS link and hotkeys work again.
  void store.value?.apply([offer.item.id], (data) => insert(data, offer.item, offer.index));
}

// ── Calls that need the click ────────────────────────────────────────

async function refreshHotkeys(): Promise<void> {
  const set = await sdk.value?.hotkeys.list().catch(() => null);
  if (set) hotkeys.value = new Set(set.map((binding) => `${binding.action}:${binding.target}`));
}

const overGame = ref<ReadonlySet<string>>(new Set());
// The Overlay page decides what is over the game. A group's overlay is fed while it is, so the store needs to know which keys are.
watch([overGame, store], () => store.value?.setShown(overGame.value), { immediate: true });

/** Tavora's key dialog; a refusal (the panel is over the game, say) goes to the settings, which tell the user. */
async function setHotkey(action: string, item: Item): Promise<void> {
  try {
    await sdk.value?.hotkeys.set(action, item.id, item.label || t(`kind.${item.kind}`));
  } finally {
    await refreshHotkeys();
  }
}

/** "denied" is the user saying no to the consent dialog; a refusal (the panel is over the game) throws, and the settings say so. */
async function copyLink(item: Item): Promise<"copied" | "off" | "denied"> {
  const result = (await sdk.value?.overlay.copyLink(keyOf(item))) ?? "denied";
  if (result !== "denied" && store.value) {
    store.value.overlays.value = true;
    // The overlay shows the item from the start, before its first change.
    store.value.publish([item.id], list.value);
  }
  return result;
}

/** A deleted item leaves the game too, if it was shown there. */
async function hideOverGame(key: string): Promise<void> {
  await sdk.value?.overlay.hideOverGame(key);
  const next = new Set(overGame.value);
  next.delete(key);
  overGame.value = next;
}

/** Which items are over the game is Tavora's to know; the switches show that. */
async function refreshOverGame(): Promise<void> {
  const keys = await sdk.value?.overlay.overGame().catch(() => null);
  if (keys) overGame.value = new Set(keys);
}

async function preview(item: Item): Promise<void> {
  await sdk.value?.overlay.preview(keyOf(item));
}

/** Tavora's Overlay page, where overlays are added to the game and placed; the dialog goes with it. */
async function arrange(): Promise<void> {
  await sdk.value?.overlay.openPage();
}

async function resetLink(item: Item): Promise<void> {
  await sdk.value?.overlay.resetLink(keyOf(item));
}

// The cards only show once the store is there.
provide(PANEL, {
  get store() {
    return store.value!;
  },
  now,
  hotkeys,
  overGame,
  act,
  setHotkey,
  copyLink,
  keyOf,
  preview,
  resetLink,
  remove: removeItem,
  move: (id, by) => void moveRow(id, by, `[data-testid="more-${id}"]`),
  get canArrange() {
    return sdk.value?.supports("overlay.openPage") ?? false;
  },
  arrange,
});

// ── Live view: what Tavora shows over the game while the game layer is closed ──

let liveTimer: ReturnType<typeof setTimeout> | undefined;
/** Hands the list to Tavora's live view a moment after it changed, so a burst of clicks sends once. */
function sendLive(): void {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => void sdk.value?.panel.setLive(buildLiveState(list.value, t("app.more", { count: "{count}" }))).catch(() => undefined), 100);
}
watch([list, sdk], () => store.value && sendLive());

// ── What the Overlay page can add: each clock and counter, and each group shown as one line ──

const measure = canvasMeasure();
let sourcesTimer: ReturnType<typeof setTimeout> | undefined;
/** An older Tavora has no Overlay page to list them on: its first answer ends the sending. */
let sourcesUnknown = false;
/** Tells Tavora what this panel can show over the game on its own, a moment after the list changed (a count changes a group's line). */
function sendSources(): void {
  clearTimeout(sourcesTimer);
  sourcesTimer = setTimeout(() => {
    const connected = sdk.value;
    if (!connected || !store.value || sourcesUnknown) return;
    connected.overlay.setSources(buildSources(list.value, measure, (item) => item.label || t(`kind.${item.kind}`))).catch((reason: { code?: string }) => {
      if (reason?.code === "UNKNOWN_METHOD") sourcesUnknown = true;
      else console.warn("[clock-counter] sources", errorMessage(reason));
    });
  }, 300);
}
watch([list, sdk], () => store.value && sendSources());

/** The Overlay page added or removed overlays: the switches follow, and what is over the game now shows its state from the start. */
function overGameChanged(keys: string[]): void {
  const before = overGame.value;
  overGame.value = new Set(keys);
  for (const key of keys) if (!before.has(key)) store.value?.publishKey(key, list.value);
}

/** Settings on a frame of the Overlay page: Tavora has the dialog open already; it shows the item's or group's settings. */
function openSettingsFor(key: string): void {
  pendingKey.value = key;
  startPage.value = "text";
  startCount.value++;
  findPending();
}

/** Finds the item of the pressed overlay once the list is loaded; one that is gone closes the dialog. */
function findPending(): void {
  if (!pendingKey.value || !store.value) return;
  const item = itemForKey(list.value, pendingKey.value);
  pendingKey.value = null;
  if (item) editing.value = item.id;
  else if (dialogOpen.value) void sdk.value?.panel.closeDialog();
}
watch(store, findPending);

const cleanup: (() => void)[] = [];

onMounted(async () => {
  addEventListener("keydown", onKey);
  try {
    const connection = await connectModule({ texts: { en, de } });
    if (connection.status !== "ready" || !connection.sdk) throw connection.error;
    const connected = connection.sdk;
    // The components read the module's own translator; it follows the language the handle reports.
    setLanguage(connection.language);
    cleanup.push(connection.onLanguage(setLanguage), connection.dispose);
    // Told about the dialog and a Settings press before the list loads (the slow part), so the settings' placeholder can stand in for it.
    cleanup.push(
      connected.panel.onDialogChange((open) => {
        dialogOpen.value = open;
        if (!open) {
          editing.value = null;
          pendingKey.value = null;
        }
      }),
      connected.panel.onOpenSettings(({ key }) => openSettingsFor(key)),
    );
    const items = await createItemStore(connected);
    cleanup.push(
      () => void items.dispose(),
      connected.hotkeys.onPress(({ action, target }) => act(action, target)),
      connected.overlay.onOverGameChange(overGameChanged),
      connected.lifecycle.onSuspend(() => (suspended.value = true)),
      connected.lifecycle.onResume(() => {
        suspended.value = false;
        void refreshOverGame();
      }),
    );
    sdk.value = connected;
    store.value = items;
    await refreshHotkeys();
    await refreshOverGame();
    // What is over the game after a restart shows nothing until its state is published again.
    for (const key of overGame.value) items.publishKey(key, items.list.value);
    sendSources();
    void document.fonts.ready.then(sendSources);
  } catch (reason) {
    error.value = errorMessage(reason);
  }
});

onBeforeUnmount(() => {
  removeEventListener("keydown", onKey);
  cleanup.forEach((fn) => fn());
  clearInterval(ticker);
  clearTimeout(liveTimer);
  clearTimeout(sourcesTimer);
  clearTimeout(noticeTimer);
  if (undo.value) clearTimeout(undo.value.timer);
});
</script>

<template>
  <!-- Never an empty dialog: while the panel starts and the list loads, the settings' own layout is there as placeholder. -->
  <p v-if="!store && error" class="text-muted-foreground p-4 text-sm" data-testid="status">{{ t("connectError", { error }) }}</p>
  <SettingsSkeleton v-else-if="!store ? dialogOpen || !!pendingKey : dialogOpen && !editedItem" />
  <p v-else-if="!store" class="text-muted-foreground p-4 text-sm" data-testid="status">{{ t("loading") }}</p>
  <ItemEditor v-else-if="dialogOpen && editedItem" :key="editedItem.id" :title="dialogTitle ?? ''" :titled="titled" :item="editedItem" :start="startPage" :start-count="startCount" />
  <div v-else class="relative flex h-full min-h-0 flex-col" data-testid="clock-counter-app">
    <header class="border-primary/25 bg-primary/5 flex h-10 flex-none items-center gap-1 border-b px-2" role="toolbar" :aria-label="t('app.toolbar')">
      <p class="min-w-0 flex-1 truncate px-1 text-xs" role="status">
        <span v-if="store.error.value || error" class="text-destructive">{{ store.error.value ?? error }}</span>
        <span v-else-if="notice" class="text-foreground" data-testid="notice">{{ notice }}</span>
        <span v-else-if="list.items.length" class="text-muted-foreground tabular-nums">{{ plural("app.count", list.items.length) }}</span>
      </p>
      <!-- A kit menu, not ui.showMenu: Tavora draws no module menu while the panel is over the game. -->
      <DropdownMenu v-if="list.items.length">
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="sm" :disabled="list.items.length >= MAX.items" data-testid="add">
            <Plus :stroke-width="1.5" />
            {{ t("app.add") }}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem v-for="kind in KINDS" :key="kind" :data-testid="`pick-${kind}`" @select="addItem(kind, false)"><component :is="KIND_ICONS[kind]" />{{ t(`kind.${kind}`) }}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>

    <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto p-2 outline-none" tabindex="-1">
      <div v-if="!list.items.length" class="flex h-full flex-col items-center justify-center gap-3 px-4 py-10 text-center" data-testid="empty">
        <p class="text-muted-foreground text-sm">{{ t("app.empty") }}</p>
        <div class="flex flex-wrap justify-center gap-2">
          <Button v-for="kind in KINDS" :key="kind" variant="secondary" size="sm" :data-testid="`add-${kind}`" @click="addItem(kind)">
            <component :is="KIND_ICONS[kind]" :stroke-width="1.5" /> {{ t(`kind.${kind}`) }}
          </Button>
        </div>
      </div>
      <div ref="listEl" class="flex flex-col gap-2" @dragover="onDragOver" @drop="onDrop">
        <div
          v-for="row in rows"
          :key="row.type === 'item' ? row.item.id : `group-${row.key}`"
          :data-reorder-id="rowId(row)"
          :draggable="rows.length > 1"
          class="rounded-lg"
          :class="dropLine(row)"
          :data-testid="`row-${rowId(row)}`"
          @dragstart="onDragStart($event, rowId(row))"
          @dragend="endDrag"
          @keydown="onRowKey"
        >
          <ItemCard v-if="row.type === 'item'" :item="row.item" @toggle-edit="toggleEdit(row.item.id)" />
          <section v-else class="border-border flex flex-col gap-1 rounded-lg border p-1" :class="[ROW_FADE, ACTIVE_GROUP]" :aria-label="t('app.linked')" data-testid="linked-group">
            <Badge variant="secondary" class="gap-1 self-start" :title="t('app.linkedHint')"><Link class="size-3" :stroke-width="1.5" aria-hidden="true" />{{ t("app.linked") }}</Badge>
            <ItemCard v-for="item in row.items" :key="item.id" :item="item" grouped @toggle-edit="toggleEdit(item.id)" />
          </section>
        </div>
      </div>
    </div>
  </div>
  <!-- Always there: the Undo of a deleted item and of a reset page shows in the settings dialog too. -->
  <Toaster />
</template>
