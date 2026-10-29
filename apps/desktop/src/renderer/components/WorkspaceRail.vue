<script setup lang="ts">
import { ChevronDown, ChevronLeft, ChevronRight, Folder, FolderOpen, Plus, Settings } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import type { FolderView, WorkspaceView, RootItem } from "../../shared/host-api";
import { cn } from "@/lib/utils";
import { act, dialog, openSettings, prompt, railToggles, state, submitAction } from "../host";
import { t } from "../i18n";
import { numberedWorkspaces } from "../shortcuts";
import { folderMenu, workspaceMenu } from "../rail-actions";
import MenuArea from "./menus/MenuArea.vue";
import MenuButton from "./menus/MenuButton.vue";
import ProfileMenu from "./profile/ProfileMenu.vue";
import RailFooterTile from "./RailFooterTile.vue";
import RailInboxButton from "./RailInboxButton.vue";
import RailModuleUpdates from "./RailModuleUpdates.vue";
import RailOverlayButton from "./RailOverlayButton.vue";
import RunningGameButton from "./RunningGameButton.vue";
import UpdateMarker from "./UpdateMarker.vue";
import RailWorkspace from "./RailWorkspace.vue";
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

// While Ctrl is held, the expanded rail shows which workspace Ctrl+1 to 9 opens.
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
const numbers = computed(() => new Map(numberedWorkspaces(library.value).map((id, index) => [id, index + 1])));
const shortcutOf = (id: string) => (ctrlHeld.value && expanded.value ? numbers.value.get(id) : undefined);
const manual = computed(() => library.value.sort === "manual");
const favorites = computed(() => library.value.favorites.map((id) => library.value.workspaces[id]).filter(isWorkspace));
// A workspace lives in one place: favorited workspaces leave the main list (and its folders) until unfavorited.
const favoriteIds = computed(() => new Set<string>(library.value.favorites));
const rootEntries = computed(() => library.value.root.filter((entry) => entry.kind === "folder" || !favoriteIds.value.has(entry.id)));
/** How many workspace names the tooltip of a folder lists. */
const FOLDER_TIP_NAMES = 8;
const folderWorkspaces = (id: string) => folder(id).workspaces.filter((workspaceId) => !favoriteIds.value.has(workspaceId));
const openFolders = reactive(new Set<string>());

function isWorkspace(workspace: WorkspaceView | undefined): workspace is WorkspaceView {
  return workspace !== undefined;
}

function isActive(workspaceId: string): boolean {
  return state.value!.screen === "workspace" && state.value!.currentWorkspaceId === workspaceId;
}

function workspace(id: string): WorkspaceView {
  return library.value.workspaces[id]!;
}

function folder(id: string): FolderView {
  return library.value.folders[id]!;
}

function toggleFolder(id: string) {
  if (openFolders.has(id)) openFolders.delete(id);
  else openFolders.add(id);
}

const open = (workspaceId: string) => act({ type: "open-workspace", workspaceId });
const menuFor = (id: string, inFavorites = false) => () => workspaceMenu(workspace(id), { inFavorites });
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

// The list of workspaces scrolls without a scrollbar; a fade and an arrow at the
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
  // The list grows and shrinks with the workspaces and folders, and with the window.
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
  kind: "workspace" | "folder";
  id: string;
}
interface Target {
  kind: "workspace" | "folder";
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
    await act({ type: "favorite", workspaceId: item.id, index: indexIn(library.value.favorites, target.id, zone) });
    return;
  }
  // Dropping a favorite back into the main list takes it out of Favorites, since it can't be in both.
  if (favoriteIds.value.has(item.id)) await act({ type: "unfavorite", workspaceId: item.id });
  if (target.kind === "folder" && zone === "into") {
    // The folder stays as the user left it: closed folders do not pop open.
    await act({ type: "move-workspace", workspaceId: item.id, folderId: target.id });
  } else if (target.place.list === "root" && zone === "into") {
    const workspaceIds = [target.id, item.id];
    prompt({
      title: t("rail.newFolder.title"),
      label: t("rail.folderName"),
      confirm: t("rail.newFolder.confirm"),
      submit: (name) => submitAction({ type: "create-folder", name, workspaceIds }),
    });
  } else if (target.place.list === "folder") {
    const ids = folder(target.place.folderId).workspaces;
    await act({ type: "move-workspace", workspaceId: item.id, folderId: target.place.folderId, index: indexIn(ids, target.id, zone) });
  } else {
    await act({ type: "move-workspace", workspaceId: item.id, folderId: null, index: indexIn(rootKeys(), target.id, zone) });
  }
}

// The favorites area itself accepts a workspace, for when the list is empty.
const favoriteZoneActive = ref(false);
function onFavoritesOver(event: DragEvent) {
  if (dragged.value?.kind !== "workspace") return;
  event.preventDefault();
  favoriteZoneActive.value = true;
}
async function onFavoritesDrop(event: DragEvent) {
  const item = dragged.value;
  favoriteZoneActive.value = false;
  onDragEnd();
  if (item?.kind !== "workspace") return;
  event.preventDefault();
  await act({ type: "favorite", workspaceId: item.id });
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

// ── Sections ───────────────────────────────────────────────────────────
// In the expanded rail the headers fold their list away for this session. The compact rail has no headers and shows
// everything, and a drag opens a folded list again, so there is always somewhere to drop.
const folded = reactive({ favorites: false, all: false });
const showFavorites = computed(() => !expanded.value || !folded.favorites || dragged.value?.kind === "workspace");
const showAll = computed(() => !expanded.value || !folded.all || dragged.value !== null);
</script>

<template>
  <nav
    ref="nav"
    class="group/rail bg-rail relative flex h-full flex-none flex-col border-r"
    :style="{ width: `${width}px` }"
    :aria-label="t('rail.workspaces')"
    data-testid="rail"
    :data-expanded="expanded"
    @keydown="onNavKey"
  >
    <!-- The flame (and the name, when expanded) is the way home. -->
    <div class="rail-entry relative flex flex-col px-2 pt-3 pb-1" :data-active="state!.screen === 'welcome'">
      <span class="rail-pill" aria-hidden="true" />
      <RailTooltip :text="t('rail.home')" :disabled="expanded">
        <button
          type="button"
          :class="
            cn(
              'flex h-10 items-center gap-2.5 rounded-lg',
              expanded ? 'hover:bg-accent px-2' : 'justify-center',
              expanded && state!.screen === 'welcome' && 'bg-accent',
            )
          "
          data-rail-item
          data-testid="rail-home"
          :aria-label="t('rail.home')"
          :aria-current="state!.screen === 'welcome' ? 'page' : undefined"
          @click="act({ type: 'show-welcome' })"
        >
          <span class="flex w-[30px] flex-none justify-center">
            <img class="rail-icon rail-icon-bare" src="/brand/flame-96.png" alt="" width="26" height="26" draggable="false" />
          </span>
          <span v-if="expanded" class="text-base font-semibold">Tavora</span>
        </button>
      </RailTooltip>
    </div>

    <div class="relative min-h-0 flex-1">
    <div ref="scroller" class="size-full overflow-x-hidden overflow-y-auto pb-2 [scrollbar-width:none]" @scroll.passive="updateScrollHints">
    <div ref="listContent">
      <section
        v-if="favorites.length || dragged?.kind === 'workspace'"
        :class="cn('flex flex-col', expanded ? 'gap-0.5' : 'mb-2 gap-1 border-b pt-1 pb-2', favoriteZoneActive && 'bg-primary/15')"
        :aria-label="t('rail.favorites')"
        data-testid="rail-favorites"
        @dragover="onFavoritesOver"
        @dragleave="favoriteZoneActive = false"
        @drop="onFavoritesDrop"
      >
        <button
          v-if="expanded"
          type="button"
          class="rail-section"
          :aria-expanded="showFavorites"
          data-testid="rail-favorites-header"
          @click="folded.favorites = !folded.favorites"
        >
          {{ t("rail.favorites") }}<ChevronDown :class="cn('size-3.5 transition-transform', !showFavorites && '-rotate-90')" :stroke-width="2" />
        </button>
        <template v-if="showFavorites">
          <RailWorkspace
            v-for="item in favorites"
            :key="item.id"
            :workspace="item"
            :testid="`rail-favorite-${item.id}`"
            :active="isActive(item.id)"
            :expanded="expanded"
            :shortcut="shortcutOf(item.id)"
            :menu="menuFor(item.id, true)"
            :hint="hintFor({ kind: 'workspace', id: item.id, place: { list: 'favorites' } })"
            v-on="dnd({ kind: 'workspace', id: item.id, place: { list: 'favorites' } })"
            @open="open(item.id)"
          />
          <p v-if="!favorites.length" class="text-muted-foreground border-input mx-2 rounded-lg border border-dashed p-2 text-center text-xs">
            {{ t("rail.dropHere") }}
          </p>
        </template>
      </section>

      <section :class="cn('flex flex-col', expanded ? 'gap-0.5' : 'gap-1 pt-1')" :aria-label="t('rail.all')">
        <button
          v-if="expanded"
          type="button"
          class="rail-section"
          :aria-expanded="showAll"
          data-testid="rail-all-header"
          @click="folded.all = !folded.all"
        >
          {{ t("rail.games") }}<ChevronDown :class="cn('size-3.5 transition-transform', !showAll && '-rotate-90')" :stroke-width="2" />
        </button>
        <template v-for="entry in showAll ? rootEntries : []" :key="`${entry.kind}:${entry.id}`">
          <RailWorkspace
            v-if="entry.kind === 'workspace'"
            :workspace="workspace(entry.id)"
            :testid="`rail-workspace-${entry.id}`"
            :active="isActive(entry.id)"
            :expanded="expanded"
            :shortcut="shortcutOf(entry.id)"
            :menu="menuFor(entry.id)"
            :hint="hintFor({ kind: 'workspace', id: entry.id, place: { list: 'root' } })"
            v-on="dnd({ kind: 'workspace', id: entry.id, place: { list: 'root' } })"
            @open="open(entry.id)"
          />
          <!-- Compact, an open folder and its workspaces share a quiet panel; expanded, they hang off a line. -->
          <div
            v-else
            :class="cn(!expanded && openFolders.has(entry.id) && 'bg-foreground/[0.05] mx-1 rounded-xl pb-1')"
            :data-testid="`rail-folder-${entry.id}`"
          >
            <MenuArea :items="folderMenuFor(entry.id)" :title="folder(entry.id).name">
              <div
                :class="cn('group rail-entry relative flex items-center', !expanded && openFolders.has(entry.id) ? 'px-1' : 'px-2', folderHint(entry.id) && `drop-${folderHint(entry.id)}`)"
                draggable="true"
                v-on="dnd({ kind: 'folder', id: entry.id, place: { list: 'root' } })"
              >
                <RailTooltip
                  :text="folder(entry.id).name"
                  :disabled="expanded"
                  folder
                  :lines="folderWorkspaces(entry.id).slice(0, FOLDER_TIP_NAMES).map((id) => workspace(id).name)"
                  :more="Math.max(0, folderWorkspaces(entry.id).length - FOLDER_TIP_NAMES)"
                >
                <button
                  type="button"
                  :class="
                    cn(
                      'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left',
                      expanded ? 'hover:bg-accent px-2 py-1' : 'justify-center p-1',
                      folderHint(entry.id) === 'into' && 'ring-primary ring-2 ring-inset',
                    )
                  "
                  data-rail-item
                  :data-testid="`rail-folder-${entry.id}-toggle`"
                  :aria-expanded="openFolders.has(entry.id)"
                  :aria-label="t('rail.folder', { name: folder(entry.id).name })"
                  @click="toggleFolder(entry.id)"
                >
                  <template v-if="expanded">
                    <span class="text-muted-foreground flex size-[30px] flex-none items-center justify-center">
                      <component :is="openFolders.has(entry.id) ? FolderOpen : Folder" class="size-[18px]" :stroke-width="1.5" />
                    </span>
                    <span class="flex-1 truncate text-base font-medium">{{ folder(entry.id).name }}</span>
                    <span class="text-muted-foreground mr-1 flex-none text-xs tabular-nums">{{ folderWorkspaces(entry.id).length }}</span>
                  </template>
                  <FolderTile
                    v-else
                    style="zoom: 0.8334"
                    :workspaces="folderWorkspaces(entry.id).slice(0, 4).map(workspace)"
                    :label="folder(entry.id).label"
                    :open="openFolders.has(entry.id)"
                  />
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
            <div
              v-if="openFolders.has(entry.id)"
              :class="cn('relative flex flex-col', expanded ? 'mt-0.5 ml-[31px] gap-0.5' : 'mt-1 gap-1 [&>div]:px-1')"
              role="group"
              :aria-label="folder(entry.id).name"
              data-testid="folder-workspaces"
            >
              <span v-if="expanded && folderWorkspaces(entry.id).length" class="bg-border absolute top-0 bottom-[17px] left-0 w-px" aria-hidden="true" />
              <RailWorkspace
                v-for="id in folderWorkspaces(entry.id)"
                :key="id"
                :workspace="workspace(id)"
                :testid="`rail-workspace-${id}`"
                :active="isActive(id)"
                :expanded="expanded"
                nested
                :shortcut="shortcutOf(id)"
                :menu="menuFor(id)"
                :hint="hintFor({ kind: 'workspace', id, place: { list: 'folder', folderId: entry.id } })"
                v-on="dnd({ kind: 'workspace', id, place: { list: 'folder', folderId: entry.id } })"
                @open="open(id)"
              />
              <p v-if="!folder(entry.id).workspaces.length" class="text-muted-foreground p-2 text-center text-xs">{{ t("rail.emptyFolder") }}</p>
            </div>
          </div>
        </template>
        <!-- Add game is one more entry under the last workspace: a tile when compact, a quiet row when expanded. -->
        <div class="rail-entry group relative mt-1 flex items-center px-2">
          <RailTooltip :text="t('common.addGame')" :disabled="expanded">
            <button
              type="button"
              :class="
                cn(
                  'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left',
                  expanded ? 'text-muted-foreground hover:text-foreground hover:bg-accent px-2 py-1' : 'justify-center p-1',
                )
              "
              data-rail-item
              data-testid="rail-add-game"
              :aria-label="t('common.addGame')"
              @click="dialog = { kind: 'add-game' }"
            >
              <span v-if="expanded" class="flex size-[30px] flex-none items-center justify-center">
                <Plus class="size-[18px]" :stroke-width="1.75" />
              </span>
              <span
                v-else
                class="rail-icon bg-card text-primary group-hover:bg-primary group-hover:text-primary-foreground flex size-10 flex-none items-center justify-center rounded-[10px]"
              >
                <Plus class="size-5" :stroke-width="1.75" />
              </span>
              <span v-if="expanded" class="text-base font-medium">{{ t("common.addGame") }}</span>
            </button>
          </RailTooltip>
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

    <!-- User things live at the bottom on their own: a game running now, then Settings, and the profile last. -->
    <div class="flex flex-col gap-0.5 py-2">
      <RunningGameButton :expanded="expanded" />
      <UpdateMarker :expanded="expanded" />
      <RailOverlayButton :expanded="expanded" />
      <RailModuleUpdates :expanded="expanded" />
      <RailInboxButton :expanded="expanded" />
      <RailTooltip :text="t('rail.settings')" :disabled="expanded">
        <button
          type="button"
          :class="cn('group text-muted-foreground hover:text-foreground mx-2 flex items-center gap-2.5 rounded-lg p-1 group-data-[expanded=true]/rail:px-2 transition-colors focus-visible:-outline-offset-2', expanded && 'hover:bg-accent')"
          data-rail-item
          data-testid="rail-settings"
          :aria-label="t('rail.settings')"
          aria-haspopup="dialog"
          @click="openSettings()"
        >
          <RailFooterTile>
            <Settings class="size-5 transition-transform duration-300 group-hover:rotate-45 motion-reduce:group-hover:rotate-0" :stroke-width="1.5" />
          </RailFooterTile>
          <span v-if="expanded" class="text-sm font-medium">{{ t("rail.settings") }}</span>
        </button>
      </RailTooltip>
    </div>
    <div :class="cn('flex flex-col border-t', expanded ? 'py-2.5' : 'py-2')">
      <ProfileMenu :expanded="expanded" />
    </div>

    <!-- The right edge: hovering it shows a handle that opens or closes the rail; dragging it resizes an open rail.
         It stays inside the rail, since module panels drawn over the workspace would cover anything beyond it. -->
    <div class="group/edge app-no-drag absolute inset-y-0 right-0 z-10 w-3">
      <div
        v-if="expanded"
        class="group-hover/edge:bg-primary/15 focus-visible:bg-primary absolute inset-y-0 right-0 w-1.5 cursor-col-resize focus-visible:outline-none"
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
      <button
        type="button"
        class="bg-accent text-primary border-primary/60 hover:border-primary focus-visible:ring-ring absolute top-1/2 right-0.5 grid h-11 w-3 -translate-y-1/2 place-items-center rounded-full border opacity-0 shadow-sm shadow-black/30 transition-opacity group-hover/edge:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
        data-testid="rail-toggle"
        :aria-label="expanded ? t('rail.collapse') : t('rail.expand')"
        :title="expanded ? t('rail.collapse') : t('rail.expand')"
        :aria-expanded="expanded"
        @click="toggleRail"
      >
        <component :is="expanded ? ChevronLeft : ChevronRight" class="size-2.5" :stroke-width="3" />
      </button>
    </div>
  </nav>
</template>
