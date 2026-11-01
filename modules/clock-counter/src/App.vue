<script setup lang="ts">
// Clock & Counter: a toolbar with Add, then the workspace's clocks and counters. Every panel of a workspace shows the same
// list; which settings are open is each panel's own. Running clocks tick here only while the panel is visible: they
// keep their start time, so nothing is lost while it is hidden. Hotkeys arrive at the panel used last.
import { Link, Plus } from "@lucide/vue";
import { connectModule, errorMessage } from "@tavora/official-ui";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Toaster, toast } from "@tavora/official-ui/components/ui/toast";
import { TavoraError, type GameOverlayResult, type MenuOptions, type TavoraSDK } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from "vue";
import { plural, setLanguage, t } from "./i18n";
import ItemCard from "./ItemCard.vue";
import ItemEditor from "./ItemEditor.vue";
import { count, find, groupOf, insert, lap, linkedGroups, MAX, newItem, parseList, remove, resetClock, resetCounter, startPause, visualOrder, type Counter, type Item, type ItemKind, type ItemList } from "./items";
import { de, en } from "./locales";
import { PANEL, UNDO_MS } from "./panel";
import { createItemStore, type ItemStore } from "./store";

const EMPTY = parseList(null);
const KINDS: ItemKind[] = ["countdown", "stopwatch", "counter"];

const sdk = shallowRef<TavoraSDK | null>(null);
const store = shallowRef<ItemStore | null>(null);
const error = ref<string | null>(null);
const editing = ref<string | null>(null);
/** This panel is shown as a dialog over the workspace; its page is then the settings of the item being edited. */
const dialogOpen = ref(false);
/** Settings are a dialog over the workspace when Tavora can; an older one gets a dialog in the middle of the panel. */
const overWorkspace = computed(() => sdk.value?.supports("panel.openDialog") ?? false);
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
const placeOf = (item: Item) => order.value.findIndex((other) => other.id === item.id);

/** The overlay an item's OBS link and Over game switch belong to: the group's, once the group is shown as a whole. */
function keyOf(item: Item): string {
  const group = item.kind === "counter" ? groupOf(list.value, item.id) : null;
  return group?.stream.whole ? group.key : item.id;
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

function openEditing(id: string): void {
  editing.value = id;
  if (overWorkspace.value) void sdk.value!.panel.openDialog({ width: 960, height: 680 }).catch(() => (editing.value = null));
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

function addItem(kind: ItemKind): void {
  const id = crypto.randomUUID();
  const same = list.value.items.filter((item) => item.kind === kind).length;
  const label = same ? `${t(`kind.${kind}`)} ${same + 1}` : t(`kind.${kind}`);
  void store.value?.apply([id], (data) => insert(data, newItem(kind, id, label)));
  // Its settings open too, to name it. From the menu there is no click left for the dialog over the workspace: it stays closed.
  if (overWorkspace.value) openEditing(id);
  else editing.value = id;
}

async function pickKind(event: MouseEvent): Promise<void> {
  const picked = await showMenu({
    items: KINDS.map((kind) => ({ type: "item" as const, id: kind, label: t(`kind.${kind}`) })),
    anchor: event.currentTarget as HTMLElement,
    align: "end",
  });
  if (picked) addItem(picked as ItemKind);
}

// ── Delete, with Undo ────────────────────────────────────────────────

// The offer keeps its own time, so the hotkeys go when it ends even if its toast was closed early.
const undo = shallowRef<{ item: Item; index: number; timer: ReturnType<typeof setTimeout>; toast: { dismiss: () => void } } | null>(null);

/** The undo time ran out: the item's hotkeys go too. */
function forget(item: Item): void {
  void sdk.value?.hotkeys.remove(item.id).then(refreshHotkeys, () => undefined);
}

function removeItem(item: Item): void {
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

async function setHotkey(action: string, item: Item): Promise<void> {
  try {
    await sdk.value?.hotkeys.set(action, item.id, item.label || t(`kind.${item.kind}`));
  } catch (reason) {
    error.value = errorMessage(reason);
  }
  await refreshHotkeys();
}

async function copyLink(item: Item): Promise<"copied" | "off" | "denied"> {
  const key = keyOf(item);
  try {
    const result = (await sdk.value?.overlay.copyLink(key)) ?? "denied";
    if (result !== "denied" && store.value) {
      store.value.overlays.value = true;
      // The overlay shows the item from the start, before its first change.
      store.value.publish([item.id], list.value);
    }
    return result;
  } catch (reason) {
    if (reason instanceof TavoraError && reason.code === "PERMISSION_DENIED") return "denied";
    throw reason;
  }
}

async function showOverGame(item: Item): Promise<GameOverlayResult> {
  const key = keyOf(item);
  const result = (await sdk.value?.overlay.showOverGame(key)) ?? "off";
  // The overlay shows the item from the start, before its first change.
  if (result === "shown") {
    store.value?.publish([item.id], list.value);
    overGame.value = new Set(overGame.value).add(key);
  }
  return result;
}

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

async function resetLink(item: Item): Promise<void> {
  await sdk.value?.overlay.resetLink(keyOf(item));
}

/** Before the panel is connected there is nothing to show a menu with. */
const showMenu = (request: MenuOptions) => sdk.value?.ui.showMenu(request) ?? Promise.resolve(null);

// The cards only show once the store is there.
provide(PANEL, {
  get store() {
    return store.value!;
  },
  now,
  hotkeys,
  act,
  setHotkey,
  copyLink,
  overGame,
  keyOf,
  showOverGame,
  hideOverGame,
  preview,
  resetLink,
  remove: removeItem,
  showMenu,
});

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
    const items = await createItemStore(connected);
    cleanup.push(
      connected.panel.onDialogChange((open) => {
        dialogOpen.value = open;
        if (!open) editing.value = null;
      }),
      () => void items.dispose(),
      connected.hotkeys.onPress(({ action, target }) => act(action, target)),
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
  } catch (reason) {
    error.value = errorMessage(reason);
  }
});

onBeforeUnmount(() => {
  removeEventListener("keydown", onKey);
  cleanup.forEach((fn) => fn());
  clearInterval(ticker);
  if (undo.value) clearTimeout(undo.value.timer);
});
</script>

<template>
  <p v-if="!store" class="text-muted-foreground p-4 text-sm" data-testid="status">
    {{ error ? t("connectError", { error }) : t("loading") }}
  </p>
  <ItemEditor v-else-if="dialogOpen && editedItem" page :item="editedItem" :first="placeOf(editedItem) === 0" :last="placeOf(editedItem) === order.length - 1" @close="closeEditing" />
  <div v-else class="relative flex h-full min-h-0 flex-col" data-testid="clock-counter-app">
    <header class="border-primary/25 bg-primary/5 flex h-10 flex-none items-center gap-1 border-b px-2" role="toolbar" :aria-label="t('app.toolbar')">
      <p class="min-w-0 flex-1 truncate px-1 text-xs" role="status">
        <span v-if="store.error.value || error" class="text-destructive">{{ store.error.value ?? error }}</span>
        <span v-else-if="list.items.length" class="text-muted-foreground tabular-nums">{{ plural("app.count", list.items.length) }}</span>
      </p>
      <Button v-if="list.items.length" variant="ghost" size="sm" :disabled="list.items.length >= MAX.items" data-testid="add" @click="pickKind">
        <Plus :stroke-width="1.5" />
        {{ t("app.add") }}
      </Button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-2">
      <div v-if="!list.items.length" class="flex h-full flex-col items-center justify-center gap-3 px-4 py-10 text-center" data-testid="empty">
        <p class="text-muted-foreground text-sm">{{ t("app.empty") }}</p>
        <div class="flex flex-wrap justify-center gap-2">
          <Button v-for="kind in KINDS" :key="kind" variant="secondary" size="sm" :data-testid="`add-${kind}`" @click="addItem(kind)">
            <Plus :stroke-width="1.5" /> {{ t(`kind.${kind}`) }}
          </Button>
        </div>
      </div>
      <div class="flex flex-col gap-2">
        <template v-for="row in rows" :key="row.type === 'item' ? row.item.id : `group-${row.key}`">
          <ItemCard v-if="row.type === 'item'" :item="row.item" :editing="editing === row.item.id && !overWorkspace" :first="placeOf(row.item) === 0" :last="placeOf(row.item) === order.length - 1" @toggle-edit="toggleEdit(row.item.id)" />
          <section v-else class="border-border flex flex-col gap-1 rounded-lg border p-1" :aria-label="t('app.linked')" data-testid="linked-group">
            <Badge variant="secondary" class="gap-1 self-start"><Link class="size-3" :stroke-width="1.5" aria-hidden="true" />{{ t("app.linked") }}</Badge>
            <ItemCard
              v-for="item in row.items"
              :key="item.id"
              :item="item"
              :editing="editing === item.id && !overWorkspace"
              :first="placeOf(item) === 0"
              :last="placeOf(item) === order.length - 1"
              @toggle-edit="toggleEdit(item.id)"
            />
          </section>
        </template>
      </div>
    </div>

    <Toaster />
  </div>
</template>
