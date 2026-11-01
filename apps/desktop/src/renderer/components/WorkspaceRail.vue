<script setup lang="ts">
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Gamepad2, Plus, Settings, UserRoundPlus } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import type { FolderView, WorkspaceView, RootItem } from "../../shared/host-api";
import { cn } from "@/lib/utils";
import { act, dialog, openSettings, prompt, railToggles, state, submitAction } from "../host";
import { t } from "../i18n";
import { numberedWorkspaces } from "../shortcuts";
import { folderMenu, workspaceMenu } from "../rail-actions";
import MenuArea from "./menus/MenuArea.vue";
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
const MIN_WIDTH = 200;
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

// Under the last workspace: add a game, or start a personal workspace (which belongs to no game). The labels are
// short so both fit side by side in German too; the full name is the tooltip and the accessible name.
const addButtons = computed(() => [
  { testid: "rail-add-game", name: t("common.addGame"), label: t("rail.addGame.short"), icon: Gamepad2, badge: true, run: () => (dialog.value = { kind: "add-game" }) },
  { testid: "rail-add-personal", name: t("rail.addPersonal"), label: t("rail.addPersonal.short"), icon: UserRoundPlus, badge: false, run: () => (dialog.value = { kind: "add-personal" }) },
]);
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
// Folders the user left open stay open after a restart. Only this window's look, so it lives in the renderer's storage;
// ids of folders that are gone are dropped on the next save.
const OPEN_FOLDERS_KEY = "tavora.rail.openFolders";
function savedOpenFolders(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(OPEN_FOLDERS_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}
const openFolders = reactive(new Set<string>(savedOpenFolders()));
watch(openFolders, () =>
  localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify([...openFolders].filter((id) => library.value.folders[id]))),
);

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
  if (list) list.scrollBy({ top: list.clientHeight * 0.8, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
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
    <!-- The flame (and the name, when expanded) is the way home. The button that opens and closes the rail ends this
         row when expanded; compact, it sits on the rail's edge at the same height and shows while the pointer is over
         the rail, so it is never taken for one of the games. -->
    <div class="relative flex items-center gap-1 pt-3 pb-1" :class="expanded && 'pr-2'">
    <div class="rail-entry relative flex min-w-0 flex-1 flex-col pl-2" :class="!expanded && 'pr-2'" :data-active="state!.screen === 'welcome'">
      <span class="rail-pill" aria-hidden="true" />
      <RailTooltip :text="t('rail.home')" :disabled="expanded">
        <button
          type="button"
          :class="
            cn(
              'flex h-10 items-center gap-2.5 rounded-lg',
              expanded ? 'hover:bg-rail-hover px-2' : 'justify-center',
              expanded && state!.screen === 'welcome' && 'bg-rail-active hover:bg-rail-active',
            )
          "
          data-rail-item
          data-testid="rail-home"
          :aria-label="t('rail.home')"
          :aria-current="state!.screen === 'welcome' ? 'page' : undefined"
          @click="act({ type: 'show-welcome' })"
        >
          <span class="flex w-10 flex-none justify-center">
            <img
              class="rail-icon rail-icon-bare max-w-none flex-none"
              src="/brand/emblem-tight-96.png"
              srcset="/brand/emblem-tight-96.png 1x, /brand/emblem-tight-192.png 2x"
              alt=""
              width="40"
              height="40"
              draggable="false"
            />
          </span>
          <span v-if="expanded" class="text-base font-semibold">Tavora</span>
        </button>
      </RailTooltip>
    </div>
      <button
        type="button"
        :class="
          cn(
            'app-no-drag text-muted-foreground hover:text-foreground focus-visible:ring-ring grid flex-none place-items-center focus-visible:ring-2 focus-visible:outline-none',
            expanded
              ? 'hover:bg-rail-hover size-8 rounded-md'
              : 'bg-card border-foreground/20 hover:border-foreground/40 absolute top-[18px] -right-[14px] z-20 size-7 rounded-md border opacity-0 shadow-sm shadow-black/30 transition-opacity group-hover/rail:opacity-100 focus-visible:opacity-100',
          )
        "
        data-testid="rail-toggle"
        :aria-label="expanded ? t('rail.collapse') : t('rail.expand')"
        :title="expanded ? t('rail.collapse') : t('rail.expand')"
        :aria-expanded="expanded"
        @click="toggleRail"
      >
        <component :is="expanded ? PanelLeftClose : PanelLeftOpen" class="size-[18px]" :stroke-width="1.5" />
      </button>
    </div>

    <!-- Favorites and the Games title stay put; only the games below them scroll. -->
    <section
      v-if="favorites.length || dragged?.kind === 'workspace'"
      :class="cn('flex flex-col gap-1', favoriteZoneActive && 'bg-primary/15')"
      :aria-label="t('rail.favorites')"
      data-testid="rail-favorites"
      @dragover="onFavoritesOver"
      @dragleave="favoriteZoneActive = false"
      @drop="onFavoritesDrop"
    >
      <h2 v-if="expanded" class="rail-section">{{ t("rail.favorites") }}</h2>
      <div v-else class="rail-section" aria-hidden="true"><span class="rail-section-line" /></div>
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
    </section>
    <section class="flex min-h-0 flex-1 flex-col" :aria-label="t('rail.all')">
      <h2 v-if="expanded" class="rail-section">{{ t("rail.games") }}</h2>
      <div v-else class="rail-section" aria-hidden="true"><span class="rail-section-line" /></div>
    <div class="relative mt-1 min-h-0 flex-1">
    <div ref="scroller" class="size-full overflow-x-hidden overflow-y-auto pb-2 [scrollbar-width:none]" @scroll.passive="updateScrollHints">
    <div ref="listContent" class="flex flex-col gap-1">
        <template v-for="entry in rootEntries" :key="`${entry.kind}:${entry.id}`">
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
          <!-- Compact, an open folder and its workspaces share a quiet panel; expanded, they hang off a line. Both keep the
               same heights, so nothing moves when the rail opens or closes. -->
          <div
            v-else
            :class="cn('relative', openFolders.has(entry.id) && 'pb-1')"
            :data-testid="`rail-folder-${entry.id}`"
          >
            <!-- Drawn behind the rows, so they keep their place and their pill stays on the rail's edge. -->
            <span
              v-if="!expanded && openFolders.has(entry.id)"
              class="bg-foreground/[0.08] ring-foreground/15 pointer-events-none absolute inset-x-2 inset-y-0 rounded-xl ring-1 ring-inset"
              aria-hidden="true"
            />
            <MenuArea :items="folderMenuFor(entry.id)" :title="folder(entry.id).name">
              <div
                :class="cn('group rail-entry relative flex items-center px-2', folderHint(entry.id) && `drop-${folderHint(entry.id)}`)"
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
                      expanded ? 'hover:bg-rail-hover group-data-[state=open]:bg-rail-hover px-2 py-1' : 'justify-center p-1',
                      folderHint(entry.id) === 'into' && 'ring-primary ring-2 ring-inset',
                    )
                  "
                  data-rail-item
                  :data-testid="`rail-folder-${entry.id}-toggle`"
                  :aria-expanded="openFolders.has(entry.id)"
                  :aria-label="t('rail.folder', { name: folder(entry.id).name })"
                  @click="toggleFolder(entry.id)"
                >
                  <FolderTile
                    :size="40"
                    :workspaces="folderWorkspaces(entry.id).slice(0, 4).map(workspace)"
                    :label="folder(entry.id).label"
                    :open="openFolders.has(entry.id)"
                  />
                  <span v-if="expanded" class="flex-1 truncate text-base font-medium">{{ folder(entry.id).name }}</span>
                </button>
                </RailTooltip>
              </div>
            </MenuArea>
            <div
              v-if="openFolders.has(entry.id)"
              :class="cn('relative mt-1 flex flex-col gap-1', expanded && 'ml-[22px]')"
              role="group"
              :aria-label="folder(entry.id).name"
              data-testid="folder-workspaces"
            >
              <span v-if="expanded && folderWorkspaces(entry.id).length" class="bg-border absolute top-0 bottom-6 left-0 w-px" aria-hidden="true" />
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
        <!-- Add game and Personal are one more entry under the last workspace: two quiet buttons side by side when
             expanded (an even split), two tiles stacked when compact. -->
        <div :class="cn('mt-1 flex px-2', expanded ? 'gap-1' : 'flex-col gap-1')" data-testid="rail-add">
          <div v-for="add in addButtons" :key="add.testid" :class="cn('rail-entry group relative flex', expanded && 'min-w-0 flex-1')">
            <RailTooltip :text="add.name">
              <button
                type="button"
                :class="
                  cn(
                    'flex min-w-0 flex-1 items-center rounded-lg text-left',
                    expanded ? 'text-muted-foreground hover:text-foreground hover:bg-rail-hover h-12 gap-1.5 px-2.5' : 'justify-center p-1',
                  )
                "
                data-rail-item
                :data-testid="add.testid"
                :aria-label="add.name"
                @click="add.run()"
              >
                <template v-if="expanded">
                  <Plus class="size-4 flex-none" :stroke-width="1.75" />
                  <span class="truncate text-sm font-medium">{{ add.label }}</span>
                </template>
                <span
                  v-else
                  class="rail-icon bg-card text-primary group-hover:bg-primary group-hover:text-primary-foreground flex size-10 flex-none items-center justify-center rounded-[10px]"
                >
                  <!-- The game's icon carries a small plus, as the person's does, so the two tiles read as a pair. -->
                  <span class="relative flex">
                    <component :is="add.icon" class="size-5" :stroke-width="1.75" />
                    <Plus
                      v-if="add.badge"
                      class="bg-card group-hover:bg-primary absolute -right-1 -bottom-1 size-2.5 rounded-full"
                      :stroke-width="3"
                    />
                  </span>
                </span>
              </button>
            </RailTooltip>
          </div>
        </div>
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
    </section>

    <!-- User things live at the bottom on their own: Settings and the like, then the profile, with a game running now
         peeking out from behind it. -->
    <div class="flex flex-col gap-1 pt-2 pb-1">
      <UpdateMarker :expanded="expanded" />
      <RailOverlayButton :expanded="expanded" />
      <RailModuleUpdates :expanded="expanded" />
      <RailInboxButton :expanded="expanded" />
      <RailTooltip :text="t('rail.settings')" :disabled="expanded">
        <button
          type="button"
          :class="cn('group text-muted-foreground hover:text-foreground mx-2 flex items-center gap-2.5 rounded-lg px-1 group-data-[expanded=true]/rail:px-2 group-data-[expanded=true]/rail:py-[5px] transition-colors focus-visible:-outline-offset-2', expanded && 'hover:bg-rail-hover')"
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
    <div class="flex flex-col pt-1 pb-2">
      <RunningGameButton :expanded="expanded" />
      <ProfileMenu :expanded="expanded" />
    </div>

    <div
      v-if="expanded"
      class="hover:bg-primary/15 focus-visible:bg-primary absolute inset-y-0 -right-[3px] z-10 w-1.5 cursor-col-resize focus-visible:outline-none"
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
