<script setup lang="ts">
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Settings } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import type { FolderView, GameView, RootItem } from "../../shared/host-api";
import { cn } from "@/lib/utils";
import { act, dialog, openSettings, prompt, railToggles, state, submitAction } from "../host";
import { t } from "../i18n";
import { numberedGames } from "../shortcuts";
import { folderMenu, gameMenu } from "../rail-actions";
import MenuArea from "./menus/MenuArea.vue";
import MenuButton from "./menus/MenuButton.vue";
import ProfileMenu from "./profile/ProfileMenu.vue";
import UpdateMarker from "./UpdateMarker.vue";
import RailGame from "./RailGame.vue";
import FolderTile from "./FolderTile.vue";
import RailTooltip from "./RailTooltip.vue";

const COMPACT = 72;
const MIN_WIDTH = 180;
const MAX_WIDTH = 420;
/** Below this window width an expanded rail is shown compact, so the workspace keeps its room. */
const NARROW_WINDOW = 1100;

const library = computed(() => state.value!.library);

// In a narrow window the rail is compact whatever the saved setting says;
// the toggle then only expands it until the window widens again, and the
// saved setting is left alone.
const narrowQuery = matchMedia(`(max-width: ${NARROW_WINDOW - 1}px)`);
const narrow = ref(narrowQuery.matches);
const peek = ref(false);
function onNarrowChange() {
  narrow.value = narrowQuery.matches;
  peek.value = false;
}
narrowQuery.addEventListener("change", onNarrowChange);
onBeforeUnmount(() => narrowQuery.removeEventListener("change", onNarrowChange));

const expanded = computed(() => (narrow.value ? peek.value : library.value.rail.expanded));
function toggleRail() {
  if (narrow.value) peek.value = !peek.value;
  else void act({ type: "set-rail", expanded: !expanded.value });
}
watch(railToggles, toggleRail);

// While Ctrl is held, the expanded rail shows which game Ctrl+1 to 9 opens.
const ctrlHeld = ref(false);
const onCtrl = (event: KeyboardEvent) => (ctrlHeld.value = event.ctrlKey || event.metaKey);
const releaseCtrl = () => (ctrlHeld.value = false);
addEventListener("keydown", onCtrl);
addEventListener("keyup", onCtrl);
addEventListener("blur", releaseCtrl);
onBeforeUnmount(() => {
  removeEventListener("keydown", onCtrl);
  removeEventListener("keyup", onCtrl);
  removeEventListener("blur", releaseCtrl);
});
const numbers = computed(() => new Map(numberedGames(library.value).map((id, index) => [id, index + 1])));
const shortcutOf = (id: string) => (ctrlHeld.value && expanded.value ? numbers.value.get(id) : undefined);
const manual = computed(() => library.value.sort === "manual");
const favorites = computed(() => library.value.favorites.map((id) => library.value.games[id]).filter(isGame));
// A game lives in one place: favorited games leave the main list (and its folders) until unfavorited.
const favoriteIds = computed(() => new Set<string>(library.value.favorites));
const rootEntries = computed(() => library.value.root.filter((entry) => entry.kind === "folder" || !favoriteIds.value.has(entry.id)));
/** How many game names the tooltip of a folder lists. */
const FOLDER_TIP_GAMES = 8;
const folderGames = (id: string) => folder(id).games.filter((gameId) => !favoriteIds.value.has(gameId));
const openFolders = reactive(new Set<string>());

function isGame(game: GameView | undefined): game is GameView {
  return game !== undefined;
}

function isActive(gameId: string): boolean {
  return state.value!.screen === "game" && state.value!.currentGameId === gameId;
}

function game(id: string): GameView {
  return library.value.games[id]!;
}

function folder(id: string): FolderView {
  return library.value.folders[id]!;
}

function toggleFolder(id: string) {
  if (openFolders.has(id)) openFolders.delete(id);
  else openFolders.add(id);
}

const open = (gameId: string) => act({ type: "open-game", gameId });
const menuFor = (id: string, inFavorites = false) => () => gameMenu(game(id), { inFavorites });
const folderMenuFor = (id: string) => () => folderMenu(folder(id));

// ── Width ──────────────────────────────────────────────────────────────

const dragWidth = ref<number | null>(null);
const width = computed(() => (expanded.value ? (dragWidth.value ?? library.value.rail.width) : COMPACT));
const clampWidth = (value: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value)));

function startResize(event: PointerEvent) {
  const handle = event.currentTarget as HTMLElement;
  const startX = event.clientX;
  const startWidth = width.value;
  handle.setPointerCapture(event.pointerId);
  const move = (next: PointerEvent) => (dragWidth.value = clampWidth(startWidth + next.clientX - startX));
  const end = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    if (dragWidth.value !== null) void act({ type: "set-rail", width: dragWidth.value }).then(() => (dragWidth.value = null));
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

function resizeByKey(event: KeyboardEvent) {
  const step = event.key === "ArrowRight" ? 16 : event.key === "ArrowLeft" ? -16 : 0;
  if (!step) return;
  event.preventDefault();
  void act({ type: "set-rail", width: clampWidth(width.value + step) });
}

// ── Keyboard: arrows move between rail items ───────────────────────────

const nav = ref<HTMLElement | null>(null);

// The list of games scrolls without a scrollbar; a fade and an arrow at the
// edge say that there is more, and go away at the end of the list.
const scroller = ref<HTMLElement | null>(null);
const listContent = ref<HTMLElement | null>(null);
const moreAbove = ref(false);
const moreBelow = ref(false);
function updateScrollHints() {
  const list = scroller.value;
  if (!list) return;
  moreAbove.value = list.scrollTop > 1;
  moreBelow.value = list.scrollTop + list.clientHeight < list.scrollHeight - 1;
}
let sizeWatcher: ResizeObserver | undefined;
onMounted(() => {
  // The list grows and shrinks with the games and folders, and with the window.
  sizeWatcher = new ResizeObserver(updateScrollHints);
  if (scroller.value) sizeWatcher.observe(scroller.value);
  if (listContent.value) sizeWatcher.observe(listContent.value);
  updateScrollHints();
});
onBeforeUnmount(() => sizeWatcher?.disconnect());
function scrollMore() {
  const list = scroller.value;
  if (list) list.scrollBy({ top: list.clientHeight * 0.8, behavior: "smooth" });
}

function onNavKey(event: KeyboardEvent) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const items = [...(nav.value?.querySelectorAll<HTMLElement>("[data-rail-item]") ?? [])];
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return;
  event.preventDefault();
  items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
}

// ── Drag and drop ──────────────────────────────────────────────────────
// Every move here also exists in the item menus (rail-actions.ts).

type Zone = "before" | "after" | "into";
type Place = { list: "favorites" } | { list: "root" } | { list: "folder"; folderId: string };
interface Dragged {
  kind: "game" | "folder";
  id: string;
}
interface Target {
  kind: "game" | "folder";
  id: string;
  place: Place;
}

const dragged = ref<Dragged | null>(null);
const hint = ref<{ key: string; zone: Zone } | null>(null);

const keyOf = (target: Target) =>
  `${target.place.list === "folder" ? target.place.folderId : target.place.list}:${target.kind}:${target.id}`;

function hintFor(target: Target): Zone | null {
  return hint.value?.key === keyOf(target) ? hint.value.zone : null;
}

function onDragStart(event: DragEvent, item: Dragged) {
  dragged.value = item;
  event.dataTransfer?.setData("text/plain", item.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  // Dim the item where it came from, a frame later so the drag image stays solid.
  const row = event.currentTarget as HTMLElement;
  requestAnimationFrame(() => row.classList.add("drag-source"));
}

function onDragEnd() {
  dragged.value = null;
  hint.value = null;
}

/** Which drops make sense for this target, given what is being dragged. */
function zones(target: Target): Zone[] {
  const item = dragged.value;
  if (!item) return [];
  const reorder = target.place.list !== "root" || manual.value;
  if (item.kind === "folder") {
    return target.place.list === "root" && manual.value && item.id !== target.id ? ["before", "after"] : [];
  }
  if (target.place.list === "favorites") return ["before", "after"];
  if (target.kind === "folder") return reorder ? ["before", "into", "after"] : ["into"];
  if (target.id === item.id) return [];
  if (target.place.list === "root") return reorder ? ["before", "into", "after"] : ["into"];
  return ["before", "after"];
}

function zoneAt(event: DragEvent, allowed: Zone[]): Zone {
  if (allowed.length === 1) return allowed[0]!;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const y = (event.clientY - rect.top) / rect.height;
  if (!allowed.includes("into")) return y < 0.5 ? "before" : "after";
  return y < 0.25 ? "before" : y > 0.75 ? "after" : "into";
}

function onDragOver(event: DragEvent, target: Target) {
  const allowed = zones(target);
  if (!allowed.length) return;
  event.preventDefault();
  event.stopPropagation();
  hint.value = { key: keyOf(target), zone: zoneAt(event, allowed) };
}

function onDragLeave(event: DragEvent, target: Target) {
  const related = event.relatedTarget as Node | null;
  if (related && (event.currentTarget as HTMLElement).contains(related)) return;
  if (hint.value?.key === keyOf(target)) hint.value = null;
}

/** Index in a list once the dragged item is taken out of it. */
function indexIn(ids: string[], targetId: string, zone: Zone): number {
  const without = ids.filter((id) => id !== dragged.value?.id);
  const index = without.indexOf(targetId);
  return zone === "after" ? index + 1 : index;
}

const rootKeys = () => library.value.root.map((item: RootItem) => item.id);

async function onDrop(event: DragEvent, target: Target) {
  const item = dragged.value;
  const zone = hint.value?.key === keyOf(target) ? hint.value.zone : null;
  onDragEnd();
  if (!item || !zone) return;
  event.preventDefault();
  event.stopPropagation();

  if (item.kind === "folder") {
    await act({ type: "move-folder", folderId: item.id, index: indexIn(rootKeys(), target.id, zone) });
    return;
  }
  if (target.place.list === "favorites") {
    await act({ type: "favorite", gameId: item.id, index: indexIn(library.value.favorites, target.id, zone) });
    return;
  }
  // Dropping a favorite back into the main list takes it out of Favorites, since it can't be in both.
  if (favoriteIds.value.has(item.id)) await act({ type: "unfavorite", gameId: item.id });
  if (target.kind === "folder" && zone === "into") {
    // The folder stays as the player left it: closed folders do not pop open.
    await act({ type: "move-game", gameId: item.id, folderId: target.id });
  } else if (target.place.list === "root" && zone === "into") {
    const gameIds = [target.id, item.id];
    prompt({
      title: t("rail.newFolder.title"),
      label: t("rail.folderName"),
      confirm: t("rail.newFolder.confirm"),
      submit: (name) => submitAction({ type: "create-folder", name, gameIds }),
    });
  } else if (target.place.list === "folder") {
    const ids = folder(target.place.folderId).games;
    await act({ type: "move-game", gameId: item.id, folderId: target.place.folderId, index: indexIn(ids, target.id, zone) });
  } else {
    await act({ type: "move-game", gameId: item.id, folderId: null, index: indexIn(rootKeys(), target.id, zone) });
  }
}

// The favorites area itself accepts a game, for when the list is empty.
const favoriteZoneActive = ref(false);
function onFavoritesOver(event: DragEvent) {
  if (dragged.value?.kind !== "game") return;
  event.preventDefault();
  favoriteZoneActive.value = true;
}
async function onFavoritesDrop(event: DragEvent) {
  const item = dragged.value;
  favoriteZoneActive.value = false;
  onDragEnd();
  if (item?.kind !== "game") return;
  event.preventDefault();
  await act({ type: "favorite", gameId: item.id });
}

/** Drag handlers for one rail item, bound with v-on. */
function dnd(target: Target, item: Dragged = { kind: target.kind, id: target.id }) {
  return {
    dragstart: (event: DragEvent) => onDragStart(event, item),
    dragend: (event: DragEvent) => {
      (event.currentTarget as HTMLElement).classList.remove("drag-source");
      onDragEnd();
    },
    dragover: (event: DragEvent) => onDragOver(event, target),
    dragleave: (event: DragEvent) => onDragLeave(event, target),
    drop: (event: DragEvent) => void onDrop(event, target),
  };
}

const folderHint = (id: string) => hintFor({ kind: "folder", id, place: { list: "root" } });
</script>

<template>
  <nav
    ref="nav"
    class="bg-rail relative flex h-full flex-none flex-col border-r"
    :style="{ width: `${width}px` }"
    :aria-label="t('rail.games')"
    data-testid="rail"
    :data-expanded="expanded"
    @keydown="onNavKey"
  >
    <div class="rail-entry relative flex flex-col border-b p-2" :data-active="state!.screen === 'welcome'">
      <span class="rail-pill" aria-hidden="true" />
      <button
        type="button"
        :class="cn('flex h-12 items-center gap-3 rounded-lg px-3', expanded && 'hover:bg-accent', expanded && state!.screen === 'welcome' && 'bg-accent')"
        data-rail-item
        data-testid="rail-home"
        :aria-label="t('rail.home')"
        :aria-current="state!.screen === 'welcome' ? 'page' : undefined"
        :title="t('rail.home')"
        @click="act({ type: 'show-welcome' })"
      >
        <img class="rail-icon rail-icon-bare" src="/brand/flame-96.png" alt="" width="32" height="32" draggable="false" />
        <span v-if="expanded" class="text-lg font-semibold">Tavora</span>
      </button>
    </div>

    <div class="relative min-h-0 flex-1">
    <div ref="scroller" class="size-full overflow-x-hidden overflow-y-auto py-2 [scrollbar-width:none]" @scroll.passive="updateScrollHints">
    <div ref="listContent">
      <section
        v-if="favorites.length || dragged?.kind === 'game'"
        :class="cn('mb-2 flex flex-col gap-1 border-b pb-2', favoriteZoneActive && 'bg-primary/15')"
        :aria-label="t('rail.favorites')"
        data-testid="rail-favorites"
        @dragover="onFavoritesOver"
        @dragleave="favoriteZoneActive = false"
        @drop="onFavoritesDrop"
      >
        <h2 v-if="expanded" class="text-muted-foreground mx-4 my-1 text-xs font-medium">{{ t("rail.favorites") }}</h2>
        <RailGame
          v-for="item in favorites"
          :key="item.id"
          :game="item"
          :testid="`rail-favorite-${item.id}`"
          :active="isActive(item.id)"
          :expanded="expanded"
          :shortcut="shortcutOf(item.id)"
          :menu="menuFor(item.id, true)"
          :hint="hintFor({ kind: 'game', id: item.id, place: { list: 'favorites' } })"
          v-on="dnd({ kind: 'game', id: item.id, place: { list: 'favorites' } })"
          @open="open(item.id)"
        />
        <p v-if="!favorites.length" class="text-muted-foreground border-input mx-2 rounded-lg border border-dashed p-2 text-center text-xs">
          {{ t("rail.dropHere") }}
        </p>
      </section>

      <section class="flex flex-col gap-1" :aria-label="t('rail.all')">
        <template v-for="entry in rootEntries" :key="`${entry.kind}:${entry.id}`">
          <RailGame
            v-if="entry.kind === 'game'"
            :game="game(entry.id)"
            :testid="`rail-game-${entry.id}`"
            :active="isActive(entry.id)"
            :expanded="expanded"
            :shortcut="shortcutOf(entry.id)"
            :menu="menuFor(entry.id)"
            :hint="hintFor({ kind: 'game', id: entry.id, place: { list: 'root' } })"
            v-on="dnd({ kind: 'game', id: entry.id, place: { list: 'root' } })"
            @open="open(entry.id)"
          />
          <div
            v-else
            :class="cn(openFolders.has(entry.id) && 'bg-primary/10 ring-primary/40 mx-1 rounded-xl pb-1 ring-1 ring-inset')"
            :data-testid="`rail-folder-${entry.id}`"
          >
            <MenuArea :items="folderMenuFor(entry.id)" :title="folder(entry.id).name">
              <div
                :class="cn('group rail-entry relative flex items-center', openFolders.has(entry.id) ? 'px-1' : 'px-2', folderHint(entry.id) && `drop-${folderHint(entry.id)}`)"
                draggable="true"
                v-on="dnd({ kind: 'folder', id: entry.id, place: { list: 'root' } })"
              >
                <RailTooltip
                  :text="folder(entry.id).name"
                  :disabled="expanded"
                  folder
                  :lines="folderGames(entry.id).slice(0, FOLDER_TIP_GAMES).map((id) => game(id).name)"
                  :more="Math.max(0, folderGames(entry.id).length - FOLDER_TIP_GAMES)"
                >
                <button
                  type="button"
                  :class="cn('flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left', expanded && 'hover:bg-accent', folderHint(entry.id) === 'into' && 'ring-primary ring-2 ring-inset')"
                  data-rail-item
                  :data-testid="`rail-folder-${entry.id}-toggle`"
                  :aria-expanded="openFolders.has(entry.id)"
                  :aria-label="t('rail.folder', { name: folder(entry.id).name })"
                  @click="toggleFolder(entry.id)"
                >
                  <FolderTile
                    :games="folderGames(entry.id).slice(0, 4).map(game)"
                    :count="folderGames(entry.id).length"
                    :label="folder(entry.id).label"
                    :open="openFolders.has(entry.id)"
                  />
                  <template v-if="expanded">
                    <span class="flex-1 truncate text-sm font-medium">{{ folder(entry.id).name }}</span>
                    <component :is="openFolders.has(entry.id) ? ChevronDown : ChevronRight" class="text-muted-foreground mr-8 size-4 flex-none" />
                  </template>
                </button>
                </RailTooltip>
                <div
                  v-if="expanded"
                  class="bg-accent absolute right-4 opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100"
                >
                  <MenuButton
                    :items="folderMenuFor(entry.id)"
                    :title="folder(entry.id).name"
                    :testid="`rail-folder-${entry.id}-menu`"
                    :label="t('rail.moreFolder', { name: folder(entry.id).name })"
                  />
                </div>
              </div>
            </MenuArea>
            <!-- An open folder and its games sit in one tinted panel. The games keep the size and the place of the rest of the rail. -->
            <div
              v-if="openFolders.has(entry.id)"
              class="mt-1 flex flex-col gap-1 [&>div]:px-1"
              role="group"
              :aria-label="folder(entry.id).name"
              data-testid="folder-games"
            >
              <RailGame
                v-for="id in folderGames(entry.id)"
                :key="id"
                :game="game(id)"
                :testid="`rail-game-${id}`"
                :active="isActive(id)"
                :expanded="expanded"
                :shortcut="shortcutOf(id)"
                :menu="menuFor(id)"
                :hint="hintFor({ kind: 'game', id, place: { list: 'folder', folderId: entry.id } })"
                v-on="dnd({ kind: 'game', id, place: { list: 'folder', folderId: entry.id } })"
                @open="open(id)"
              />
              <p v-if="!folder(entry.id).games.length" class="text-muted-foreground p-2 text-center text-xs">{{ t("rail.emptyFolder") }}</p>
            </div>
          </div>
        </template>
        <!-- Add game is a tile under the last game, like one more entry in the list. -->
        <div class="rail-entry group relative mt-1 flex items-center px-2">
          <button
            type="button"
            :class="cn('flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left', expanded && 'hover:bg-accent')"
            data-rail-item
            data-testid="rail-add-game"
            :aria-label="t('common.addGame')"
            :title="t('common.addGame')"
            @click="dialog = { kind: 'add-game' }"
          >
            <span
              class="rail-icon bg-card text-primary group-hover:bg-primary group-hover:text-primary-foreground flex size-12 flex-none items-center justify-center rounded-[12px]"
            >
              <Plus class="size-6" :stroke-width="1.75" />
            </span>
            <span v-if="expanded" class="text-sm font-medium">{{ t("common.addGame") }}</span>
          </button>
        </div>
      </section>
    </div>
    </div>
    <div v-if="moreAbove" class="from-rail pointer-events-none absolute inset-x-0 top-0 h-8 bg-linear-to-b to-transparent" aria-hidden="true" data-testid="rail-fade-top" />
    <div v-if="moreBelow" class="from-rail pointer-events-none absolute inset-x-0 bottom-0 flex h-14 items-end justify-center bg-linear-to-t to-transparent" data-testid="rail-fade-bottom">
      <button
        type="button"
        tabindex="-1"
        class="rail-more text-muted-foreground hover:text-foreground pointer-events-auto mb-0.5 flex h-6 w-10 items-center justify-center rounded-full"
        :aria-label="t('rail.scrollDown')"
        :title="t('rail.scrollDown')"
        data-testid="rail-scroll-down"
        @click="scrollMore"
      >
        <ChevronDown class="size-5" :stroke-width="2" />
      </button>
    </div>
    </div>

    <!-- Player things live at the bottom on their own: the profile, then Settings. -->
    <div class="flex flex-col gap-1 border-t py-2">
      <UpdateMarker :expanded="expanded" />
      <ProfileMenu :expanded="expanded" />
      <button
        type="button"
        :class="cn('group text-muted-foreground hover:text-foreground mx-2 flex h-10 items-center gap-3 rounded-lg px-1 transition-colors', expanded && 'hover:bg-accent')"
        data-rail-item
        data-testid="rail-settings"
        :aria-label="t('rail.settings')"
        aria-haspopup="dialog"
        :title="t('rail.settings')"
        @click="openSettings()"
      >
        <!-- A 48 px slot keeps the icon on the same centre line as the tiles. -->
        <span class="flex w-12 flex-none justify-center">
          <Settings class="size-5 transition-transform duration-300 group-hover:rotate-45 motion-reduce:group-hover:rotate-0" :stroke-width="1.5" />
        </span>
        <span v-if="expanded" class="text-sm font-medium">{{ t("rail.settings") }}</span>
      </button>
    </div>

    <button
      type="button"
      class="app-no-drag bg-rail text-muted-foreground hover:text-foreground hover:border-primary/60 focus-visible:ring-ring absolute top-5 -right-3 z-20 grid size-6 place-items-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:outline-none"
      data-testid="rail-toggle"
      :aria-label="expanded ? t('rail.collapse') : t('rail.expand')"
      :title="expanded ? t('rail.collapse') : t('rail.expand')"
      :aria-expanded="expanded"
      @click="toggleRail"
    >
      <component :is="expanded ? ChevronLeft : ChevronRight" class="size-3.5" :stroke-width="2" />
    </button>

    <div
      v-if="expanded"
      class="hover:bg-primary/15 focus-visible:bg-primary/15 absolute inset-y-0 -right-[3px] z-10 w-1.5 cursor-col-resize focus-visible:outline-none"
      role="separator"
      aria-orientation="vertical"
      :aria-label="t('rail.resize')"
      :aria-valuenow="width"
      :aria-valuemin="MIN_WIDTH"
      :aria-valuemax="MAX_WIDTH"
      tabindex="0"
      data-testid="rail-resize"
      @pointerdown.prevent="startResize"
      @keydown="resizeByKey"
    />
  </nav>
</template>
