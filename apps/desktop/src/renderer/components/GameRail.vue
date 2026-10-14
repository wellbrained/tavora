<script setup lang="ts">
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen, Plus, Settings } from "@lucide/vue";
import { computed, reactive, ref } from "vue";
import type { FolderView, GameView, RootItem } from "../../shared/host-api";
import { cn } from "@/lib/utils";
import { act, dialog, prompt, settingsOpen, state, submitAction } from "../host";
import { folderMenu, gameMenu } from "../rail-actions";
import GameIcon from "./GameIcon.vue";
import MenuArea from "./menus/MenuArea.vue";
import MenuButton from "./menus/MenuButton.vue";
import RailGame from "./RailGame.vue";

const COMPACT = 72;
const MIN_WIDTH = 180;
const MAX_WIDTH = 420;

const library = computed(() => state.value!.library);
const expanded = computed(() => library.value.rail.expanded);
const manual = computed(() => library.value.sort === "manual");
const favorites = computed(() => library.value.favorites.map((id) => library.value.games[id]).filter(isGame));
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
  } else if (target.kind === "folder" && zone === "into") {
    await act({ type: "move-game", gameId: item.id, folderId: target.id });
    openFolders.add(target.id);
  } else if (target.place.list === "root" && zone === "into") {
    const gameIds = [target.id, item.id];
    prompt({
      title: "New folder",
      label: "Folder name",
      confirm: "Create",
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
    dragend: onDragEnd,
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
    aria-label="Games"
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
        aria-label="Home"
        :aria-current="state!.screen === 'welcome' ? 'page' : undefined"
        title="Home"
        @click="act({ type: 'show-welcome' })"
      >
        <img class="rail-icon rail-icon-bare" src="/brand/flame-96.png" alt="" width="32" height="32" draggable="false" />
        <span v-if="expanded" class="text-lg font-semibold">Tavora</span>
      </button>
    </div>

    <div class="flex-1 overflow-x-hidden overflow-y-auto py-2 [scrollbar-width:thin]">
      <section
        v-if="favorites.length || dragged?.kind === 'game'"
        :class="cn('mb-2 flex flex-col gap-1 border-b pb-2', favoriteZoneActive && 'bg-primary/15')"
        aria-label="Favorites"
        data-testid="rail-favorites"
        @dragover="onFavoritesOver"
        @dragleave="favoriteZoneActive = false"
        @drop="onFavoritesDrop"
      >
        <h2 v-if="expanded" class="text-muted-foreground mx-4 my-1 text-xs font-medium">Favorites</h2>
        <RailGame
          v-for="item in favorites"
          :key="item.id"
          :game="item"
          :testid="`rail-favorite-${item.id}`"
          :active="false"
          :expanded="expanded"
          :menu="menuFor(item.id, true)"
          :hint="hintFor({ kind: 'game', id: item.id, place: { list: 'favorites' } })"
          v-on="dnd({ kind: 'game', id: item.id, place: { list: 'favorites' } })"
          @open="open(item.id)"
        />
        <p v-if="!favorites.length" class="text-muted-foreground border-input mx-2 rounded-lg border border-dashed p-2 text-center text-xs">
          Drop a game here
        </p>
      </section>

      <section class="flex flex-col gap-1" aria-label="All games">
        <template v-for="entry in library.root" :key="`${entry.kind}:${entry.id}`">
          <RailGame
            v-if="entry.kind === 'game'"
            :game="game(entry.id)"
            :testid="`rail-game-${entry.id}`"
            :active="isActive(entry.id)"
            :expanded="expanded"
            :menu="menuFor(entry.id)"
            :hint="hintFor({ kind: 'game', id: entry.id, place: { list: 'root' } })"
            v-on="dnd({ kind: 'game', id: entry.id, place: { list: 'root' } })"
            @open="open(entry.id)"
          />
          <div
            v-else
            :class="cn(openFolders.has(entry.id) && 'bg-card mx-1 rounded-lg pb-1')"
            :data-testid="`rail-folder-${entry.id}`"
          >
            <MenuArea :items="folderMenuFor(entry.id)" :title="folder(entry.id).name">
              <div
                :class="cn('group rail-entry relative flex items-center', openFolders.has(entry.id) ? 'px-1' : 'px-2', folderHint(entry.id) && `drop-${folderHint(entry.id)}`)"
                draggable="true"
                v-on="dnd({ kind: 'folder', id: entry.id, place: { list: 'root' } })"
              >
                <button
                  type="button"
                  :class="cn('flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left', expanded && 'hover:bg-accent', folderHint(entry.id) === 'into' && 'ring-primary ring-2 ring-inset')"
                  data-rail-item
                  :data-testid="`rail-folder-${entry.id}-toggle`"
                  :aria-expanded="openFolders.has(entry.id)"
                  :aria-label="`Folder ${folder(entry.id).name}`"
                  :title="expanded ? undefined : folder(entry.id).name"
                  @click="toggleFolder(entry.id)"
                >
                  <span class="rail-icon bg-card flex size-12 flex-none flex-wrap content-center items-center justify-center gap-1 overflow-hidden rounded-lg p-0.5" aria-hidden="true">
                    <span v-if="folder(entry.id).label" class="font-semibold">
                      {{ folder(entry.id).label }}
                    </span>
                    <template v-else>
                      <GameIcon v-for="id in folder(entry.id).games.slice(0, 4)" :key="id" :game="game(id)" :size="20" />
                    </template>
                  </span>
                  <template v-if="expanded">
                    <span class="flex-1 truncate text-sm font-medium">{{ folder(entry.id).name }}</span>
                    <component :is="openFolders.has(entry.id) ? ChevronDown : ChevronRight" class="text-muted-foreground mr-8 size-4 flex-none" />
                  </template>
                </button>
                <div
                  v-if="expanded"
                  class="bg-accent absolute right-4 opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100"
                >
                  <MenuButton
                    :items="folderMenuFor(entry.id)"
                    :title="folder(entry.id).name"
                    :testid="`rail-folder-${entry.id}-menu`"
                    :label="`More actions for folder ${folder(entry.id).name}`"
                  />
                </div>
              </div>
            </MenuArea>
            <div v-if="openFolders.has(entry.id)" class="flex flex-col gap-1 [&>div]:px-1" role="group" :aria-label="folder(entry.id).name">
              <RailGame
                v-for="id in folder(entry.id).games"
                :key="id"
                :game="game(id)"
                :testid="`rail-game-${id}`"
                :active="isActive(id)"
                :expanded="expanded"
                :menu="menuFor(id)"
                :hint="hintFor({ kind: 'game', id, place: { list: 'folder', folderId: entry.id } })"
                v-on="dnd({ kind: 'game', id, place: { list: 'folder', folderId: entry.id } })"
                @open="open(id)"
              />
              <p v-if="!folder(entry.id).games.length" class="text-muted-foreground p-2 text-center text-xs">Empty folder</p>
            </div>
          </div>
        </template>
      </section>
    </div>

    <div class="flex flex-col gap-1 border-t p-2">
      <button
        type="button"
        class="text-muted-foreground hover:bg-accent hover:text-foreground flex h-10 items-center gap-3 rounded-lg px-3.5"
        data-rail-item
        data-testid="rail-add-game"
        aria-label="Add game"
        title="Add game"
        @click="dialog = { kind: 'add-game' }"
      >
        <Plus class="size-5 flex-none" :stroke-width="1.5" />
        <span v-if="expanded" class="text-sm font-medium">Add game</span>
      </button>
      <button
        type="button"
        class="text-muted-foreground hover:bg-accent hover:text-foreground flex h-10 items-center gap-3 rounded-lg px-3.5"
        data-rail-item
        data-testid="rail-settings"
        aria-label="Settings"
        aria-haspopup="dialog"
        title="Settings"
        @click="settingsOpen = true"
      >
        <Settings class="size-5 flex-none" :stroke-width="1.5" />
        <span v-if="expanded" class="text-sm font-medium">Settings</span>
      </button>
      <button
        type="button"
        class="text-muted-foreground hover:bg-accent hover:text-foreground flex h-10 items-center gap-3 rounded-lg px-3.5"
        data-rail-item
        data-testid="rail-toggle"
        :aria-label="expanded ? 'Collapse game list' : 'Expand game list'"
        :title="expanded ? 'Collapse game list' : 'Expand game list'"
        :aria-expanded="expanded"
        @click="act({ type: 'set-rail', expanded: !expanded })"
      >
        <component :is="expanded ? PanelLeftClose : PanelLeftOpen" class="size-5 flex-none" :stroke-width="1.5" />
        <span v-if="expanded" class="text-sm font-medium">Collapse</span>
      </button>
    </div>

    <div
      v-if="expanded"
      class="hover:bg-primary/15 focus-visible:bg-primary/15 absolute inset-y-0 -right-[3px] z-10 w-1.5 cursor-col-resize focus-visible:outline-none"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize game list"
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
