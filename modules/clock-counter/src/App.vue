<script setup lang="ts">
// Clock & Counter: a toolbar with Add, then the workspace's clocks and counters. Every panel of a workspace shows the same
// list; which settings are open is each panel's own. Running clocks tick here only while the panel is visible: they
// keep their start time, so nothing is lost while it is hidden. Hotkeys arrive at the panel used last.
import { Plus, X } from "@lucide/vue";
import { connectModule, errorMessage } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { TavoraError, type GameOverlayResult, type MenuRequest, type TavoraSDK } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from "vue";
import { plural, setLanguage, t } from "./i18n";
import ItemCard from "./ItemCard.vue";
import { count, find, insert, lap, LIST_ID, MAX, newItem, parseList, remove, resetClock, resetCounter, startPause, type Item, type ItemKind, type ItemList } from "./items";
import { PANEL, UNDO_MS } from "./panel";
import { createItemStore, type ItemStore } from "./store";

const EMPTY = parseList(null);
const KINDS: ItemKind[] = ["countdown", "stopwatch", "counter"];

const sdk = shallowRef<TavoraSDK | null>(null);
const store = shallowRef<ItemStore | null>(null);
const error = ref<string | null>(null);
const editing = ref<string | null>(null);
const now = ref(Date.now());
const hotkeys = ref<ReadonlySet<string>>(new Set());
const suspended = ref(false);

const list = computed<ItemList>(() => store.value?.list.value ?? EMPTY);
const running = computed(() => list.value.items.some((item) => item.kind !== "counter" && item.since !== null));

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

function addItem(kind: ItemKind): void {
  const id = crypto.randomUUID();
  const same = list.value.items.filter((item) => item.kind === kind).length;
  const label = same ? `${t(`kind.${kind}`)} ${same + 1}` : t(`kind.${kind}`);
  void store.value?.apply([id], (data) => insert(data, newItem(kind, id, label)));
  editing.value = id;
}

async function pickKind(event: MouseEvent): Promise<void> {
  const button = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const picked = await showMenu({
    items: KINDS.map((kind) => ({ type: "item" as const, id: kind, label: t(`kind.${kind}`) })),
    at: { x: button.left, y: button.top, width: button.width, height: button.height },
    align: "end",
  });
  if (picked) addItem(picked as ItemKind);
}

// ── Delete, with Undo ────────────────────────────────────────────────

const undo = shallowRef<{ item: Item; index: number; timer: ReturnType<typeof setTimeout> } | null>(null);

/** The undo time ran out: the item's hotkeys go too. */
function forget(item: Item): void {
  void sdk.value?.hotkeys.remove(item.id).then(refreshHotkeys, () => undefined);
}

function removeItem(item: Item): void {
  const index = list.value.items.findIndex((other) => other.id === item.id);
  if (undo.value) {
    clearTimeout(undo.value.timer);
    forget(undo.value.item);
  }
  // Counters linked to it lose the link; Undo brings back the item, not their links.
  void store.value?.apply([item.id], (data) => remove(data, item.id));
  void hideOverGame(item).catch(() => undefined);
  if (editing.value === item.id) editing.value = null;
  undo.value = { item: structuredClone(item), index, timer: setTimeout(() => dismissUndo(), UNDO_MS) };
}

function dismissUndo(): void {
  const offer = undo.value;
  undo.value = null;
  if (offer) {
    clearTimeout(offer.timer);
    forget(offer.item);
  }
}

function runUndo(): void {
  const offer = undo.value;
  undo.value = null;
  if (!offer) return;
  clearTimeout(offer.timer);
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
  try {
    const result = (await sdk.value?.overlay.copyLink(item.id)) ?? "denied";
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
  const result = (await sdk.value?.overlay.showOverGame(item.id)) ?? "off";
  // The overlay shows the item from the start, before its first change.
  if (result === "shown") {
    store.value?.publish([item.id], list.value);
    overGame.value = new Set(overGame.value).add(item.id);
  }
  return result;
}

async function hideOverGame(item: Item): Promise<void> {
  await sdk.value?.overlay.hideOverGame(item.id);
  const next = new Set(overGame.value);
  next.delete(item.id);
  overGame.value = next;
}

/** Which items are over the game is Tavora's to know; the switches show that. */
async function refreshOverGame(): Promise<void> {
  const keys = await sdk.value?.overlay.overGame().catch(() => null);
  if (keys) overGame.value = new Set(keys);
}

async function preview(item: Item): Promise<void> {
  await sdk.value?.overlay.preview(item.id);
}

async function resetLink(item: Item): Promise<void> {
  await sdk.value?.overlay.resetLink(item.id);
}

/** Before the panel is connected there is nothing to show a menu with. */
const showMenu = (request: MenuRequest) => sdk.value?.ui.showMenu(request) ?? Promise.resolve(null);

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
  showOverGame,
  hideOverGame,
  preview,
  resetLink,
  remove: removeItem,
  showMenu,
});

const cleanup: (() => void)[] = [];

onMounted(async () => {
  try {
    const connected = await connectModule(setLanguage);
    const items = createItemStore(connected);
    await items.load();
    cleanup.push(
      connected.documents.onChange((change) => change.id === LIST_ID && void items.reload()),
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
  cleanup.forEach((fn) => fn());
  clearInterval(ticker);
  if (undo.value) clearTimeout(undo.value.timer);
});
</script>

<template>
  <p v-if="!store" class="text-muted-foreground p-4 text-sm" data-testid="status">
    {{ error ? t("connectError", { error }) : t("loading") }}
  </p>
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
        <ItemCard
          v-for="(item, index) in list.items"
          :key="item.id"
          :item="item"
          :editing="editing === item.id"
          :first="index === 0"
          :last="index === list.items.length - 1"
          @toggle-edit="editing = editing === item.id ? null : item.id"
        />
      </div>
    </div>

    <div
      v-if="undo"
      class="bg-popover text-popover-foreground absolute bottom-3 left-1/2 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 rounded-lg border py-1.5 pr-1.5 pl-3 text-sm shadow-lg"
      role="status"
      data-testid="undo-toast"
    >
      <span class="min-w-0 truncate">{{ t("app.deleted", { label: undo.item.label || t(`kind.${undo.item.kind}`) }) }}</span>
      <Button variant="outline" size="sm" data-testid="undo" @click="runUndo">{{ t("undo") }}</Button>
      <Button variant="ghost" size="icon-sm" :aria-label="t('dismiss')" :title="t('dismiss')" @click="dismissUndo">
        <X :stroke-width="1.5" />
      </Button>
    </div>
  </div>
</template>
