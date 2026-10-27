<script setup lang="ts">
// The Whiteboard: a header with the board menu and the picture buttons, and the board below. Every Whiteboard panel
// of a workspace shows the same boards; which board a panel shows, its views and where its palette sits are its own state.
import { connectModule, errorMessage } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { toast, Toaster } from "@tavora/official-ui/components/ui/toast";
import { TavoraError, type TavoraSDK, type TavoraTheme } from "@tavora/sdk";
import { computed, defineAsyncComponent, h, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import BoardMenu from "./BoardMenu.vue";
import { cleanName, formatMegabytes, MAX_BOARD_BYTES, nextBoardName, sizeLevel, type BoardData, type BoardSummary } from "./boards";
import type { Controls, Pictures, SaveState, View } from "./boardSession";
import { pictureName } from "./copy";
import { language, setLanguage, t } from "./i18n";
import { DEFAULT_PALETTE, palettePlace, type PalettePlace } from "./palette";
import { unusedFiles } from "./pictures";
import { createBoards, type Boards } from "./store";
import { toolbarPlace, type ToolbarPlace } from "./toolbar";

// Excalidraw is large; the page shows the header first and the board when it has loaded.
const BoardView = defineAsyncComponent({
  loader: () => import("./BoardView.vue"),
  loadingComponent: { render: () => h("p", { class: "text-muted-foreground p-4 text-sm" }, t("loading")) },
  delay: 0,
});

interface PanelState {
  selected?: string;
  views?: Record<string, View>;
  /** Where the style palette is moved to, and whether it is folded away. */
  palette?: PalettePlace;
}

interface Shown {
  id: string;
  name: string;
  data: BoardData;
  /** Bumped to show the board again from what is stored (another panel changed it). */
  nonce: number;
}

/** How long a notice (and the Undo offer) stays when left alone. */
const NOTICE_MS = 10_000;

const sdk = shallowRef<TavoraSDK | null>(null);
const boards = shallowRef<Boards | null>(null);
const error = ref<string | null>(null);
const mode = ref<"light" | "dark">("dark");
const list = ref<BoardSummary[]>([]);
const shown = shallowRef<Shown | null>(null);
const saveState = ref<SaveState>("idle");
const bytes = ref(0);
const pictures = ref<Pictures>({ count: 0, allLocked: false });
const picturesLoaded = ref(0);
const empty = ref(true);
const copying = ref(false);
const palette = ref<PalettePlace>(DEFAULT_PALETTE);
const toolbar = ref<ToolbarPlace>("top");
let controls: Controls | null = null;

let revision = 0;
let dirty = false;
let selectedId: string | null = null;
let names = new Map<string, string>();
let views: Record<string, View> = {};
let viewTimer: ReturnType<typeof setTimeout> | undefined;
const cleanup: (() => void)[] = [];

const level = computed(() => sizeLevel(bytes.value));

/** A short message to the user, such as a picture that cannot be kept. */
function notify(message: string) {
  toast({ title: message, duration: NOTICE_MS });
}

/** A message with an Undo button. */
function offerUndo(message: string, run: () => Promise<void>) {
  toast({ title: message, duration: NOTICE_MS, action: { label: t("undo.undo"), onClick: () => void run().catch(() => undefined) } });
}

function saveSelection() {
  void sdk.value?.panel.setState({ selected: selectedId, views, palette: palette.value } as unknown as never).catch(() => undefined);
}

async function refreshList() {
  if (!boards.value) return [];
  const next = await boards.value.list();
  names = new Map(next.map((board) => [board.id, board.name]));
  list.value = next;
  return next;
}

/** Shows a board; what the current one has unsaved is stored first, when its view closes. */
async function show(id: string) {
  const opened = await boards.value?.open(id);
  if (!opened) return;
  selectedId = id;
  revision = opened.revision;
  dirty = false;
  saveState.value = "idle";
  pictures.value = { count: 0, allLocked: false };
  picturesLoaded.value = 0;
  bytes.value = JSON.stringify(opened.data).length;
  shown.value = { id, name: names.get(id) ?? "", data: opened.data, nonce: (shown.value?.nonce ?? 0) + 1 };
  saveSelection();
}

async function createBoard() {
  if (!boards.value) return;
  const created = await boards.value.create(nextBoardName([...names.values()], t("boardWord")));
  await refreshList();
  await show(created.id);
}

/** Shows the first board, making one when there is none. */
async function showFallback(next: BoardSummary[]) {
  const fallback = next[0]?.id;
  if (fallback) await show(fallback);
  else await createBoard();
}

onMounted(async () => {
  try {
    const connected = await connectModule((code) => setLanguage(code));
    // The board needs the mode for Excalidraw; the shared styles already follow the theme.
    const modeOf = (theme: TavoraTheme) => (theme.mode === "light" ? "light" : "dark");
    mode.value = modeOf(await connected.ui.getTheme());
    cleanup.push(connected.ui.onThemeChange((theme) => (mode.value = modeOf(theme))));
    const store = createBoards(connected);
    boards.value = store;
    sdk.value = connected;
    // Where the toolbar goes is one choice for every workspace.
    toolbar.value = toolbarPlace(await connected.storage.app.get("toolbar").catch(() => null));

    const [state, existing] = await Promise.all([connected.panel.getState<PanelState>(), refreshList()]);
    views = state?.views && typeof state.views === "object" ? state.views : {};
    palette.value = palettePlace(state?.palette);
    let id = existing.find((board) => board.id === state?.selected)?.id ?? existing[0]?.id;
    if (!id) {
      const created = await store.create(`${t("boardWord")} 1`);
      await refreshList();
      id = created.id;
    }
    await show(id);

    // Another panel changed, renamed or deleted a board.
    cleanup.push(
      connected.documents.onChange((change) => {
        void (async () => {
          const next = await refreshList();
          if (change.id !== selectedId) return;
          if (change.deleted) await showFallback(next);
          // This panel has nothing unsaved, so it takes over what the other panel saved.
          else if (!dirty) await show(change.id);
        })();
      }),
    );

    // Pictures that no board uses any more (of a deleted board, or taken off a board) are cleared out when a panel opens.
    void (async () => {
      const used = await store.usedFiles();
      for (const file of unusedFiles(await connected.blobs.list(), used)) await connected.blobs.delete(file.id);
    })().catch(() => undefined);
  } catch (reason) {
    error.value = errorMessage(reason);
  }
});

onBeforeUnmount(() => cleanup.forEach((fn) => fn()));

async function save(data: BoardData) {
  const id = selectedId;
  if (!boards.value || !id) return;
  revision = await boards.value.save(id, names.get(id) ?? "", data, revision);
}

function rememberView(view: View) {
  const id = selectedId;
  if (!id) return;
  views[id] = view;
  clearTimeout(viewTimer);
  viewTimer = setTimeout(saveSelection, 500);
}

function placeToolbar(place: ToolbarPlace) {
  toolbar.value = place;
  void sdk.value?.storage.app.set("toolbar", place).catch(() => undefined);
}

function placePalette(place: PalettePlace) {
  palette.value = place;
  saveSelection();
}

async function rename(value: string) {
  const id = shown.value?.id;
  const name = cleanName(value);
  if (!id || !boards.value || !name || name === names.get(id)) return;
  try {
    await boards.value.rename(id, name);
  } catch {
    notify(t("board.renameFailed"));
    return;
  }
  names.set(id, name);
  if (shown.value?.id === id) shown.value = { ...shown.value, name };
  await refreshList();
}

/** Runs a picture action from a click or key press; the host only takes the picture right after that press. */
async function pictureAction(run: (board: Controls) => Promise<void>, failed: (reason: unknown) => string) {
  const board = controls;
  if (!board || copying.value) return;
  copying.value = true;
  try {
    await run(board);
  } catch (reason) {
    notify(failed(reason));
  } finally {
    copying.value = false;
  }
}

/** What went wrong with a picture, in words for the user. */
function pictureProblem(reason: unknown, fallback: "copy.failed" | "savePicture.failed"): string {
  const code = reason instanceof TavoraError ? reason.code : undefined;
  if (code === "PERMISSION_DENIED") return t("copy.slow");
  if (code === "QUOTA_EXCEEDED") return t("copy.tooBig");
  return t(fallback, { error: reason instanceof Error ? reason.message : String(reason) });
}

/** Copy as picture, from the header button or Shift+Alt+C. */
function copyAsPicture() {
  return pictureAction(
    async (board) => {
      const copied = await board.copyAsPicture();
      notify(t(copied === "selection" ? "copy.selection" : "copy.board"));
    },
    (reason) => pictureProblem(reason, "copy.failed"),
  );
}

/** Save as picture: the same picture as Copy as picture, handed to Tavora's save dialog right after the click. */
function saveAsPicture() {
  return pictureAction(
    async (board) => {
      const saved = await board.saveAsPicture(pictureName(names.get(selectedId ?? "") ?? t("boardWord")));
      if (saved) notify(t(saved.what === "selection" ? "savePicture.selection" : "savePicture.board", { name: saved.fileName }));
    },
    (reason) => pictureProblem(reason, "savePicture.failed"),
  );
}

/** Clear board: everything off the board, with Undo in the notice (Ctrl+Z works too). */
function clearBoard() {
  const restore = controls?.clear();
  if (restore) offerUndo(t("clear.done"), async () => restore());
}

async function remove() {
  const id = shown.value?.id;
  const store = boards.value;
  if (!id || !store) return;
  const opened = await store.open(id);
  const name = names.get(id) ?? "";
  await store.remove(id);
  delete views[id];
  const next = await refreshList();
  dirty = false;
  await showFallback(next);
  if (opened) {
    offerUndo(t("undo.deleted", { name }), async () => {
      await store.restore(id, name, opened.data);
      await refreshList();
      await show(id);
    });
  }
}

function reload() {
  location.reload();
}

function togglePictureLocks() {
  controls?.setPicturesLocked(!pictures.value.allLocked);
}

function setDirty(value: boolean) {
  dirty = value;
}

function setControls(value: Controls | null) {
  controls = value;
}
</script>

<template>
  <div v-if="error" class="p-4" data-testid="connect-error">
    <Notice variant="error">
      {{ t("connectError", { error }) }}
      <template #action>
        <Button type="button" size="sm" variant="secondary" @click="reload">{{ t("retry") }}</Button>
      </template>
    </Notice>
  </div>
  <p v-else-if="!sdk || !shown" class="text-muted-foreground p-4 text-sm">{{ t("loading") }}</p>
  <div v-else class="flex h-full min-h-0 flex-col" data-testid="whiteboard-app">
    <header class="bg-primary/5 border-primary/25 flex flex-none flex-wrap items-center gap-2 border-b px-2 py-1">
      <BoardMenu :boards="list" :current-id="shown.id" :current-name="shown.name" @select="show" @create="createBoard" @rename="rename" @delete="remove" />
      <span class="flex-1" />
      <Button
        v-if="pictures.count > 0"
        type="button"
        variant="ghost"
        size="sm"
        class="text-muted-foreground"
        :title="t(pictures.allLocked ? 'image.unlockHint' : 'image.lockHint')"
        data-testid="picture-lock"
        :data-locked="pictures.allLocked"
        @click="togglePictureLocks"
      >
        {{ t(pictures.allLocked ? "image.unlock" : "image.lock") }}
      </Button>
      <Button type="button" variant="outline" size="sm" :title="t('copy.hint')" data-testid="copy-picture" :disabled="empty || copying" @click="copyAsPicture">{{ t("copy.button") }}</Button>
      <Button type="button" variant="outline" size="sm" :title="t('savePicture.hint')" data-testid="save-picture" :disabled="empty || copying" @click="saveAsPicture">{{ t("savePicture.button") }}</Button>
      <Button type="button" variant="danger" size="sm" :title="t('clear.hint')" data-testid="clear-board" :disabled="empty" @click="clearBoard">{{ t("clear.button") }}</Button>
    </header>
    <Notice v-if="level !== 'ok'" :variant="level === 'full' ? 'error' : 'warning'" class="mx-2 mt-2 flex-none" data-testid="board-size">
      {{ t(level === "full" ? "size.full" : "size.warn", { used: formatMegabytes(bytes), max: formatMegabytes(MAX_BOARD_BYTES) }) }}
    </Notice>
    <main class="relative min-h-0 flex-1" :data-board="shown.id" :data-pictures="picturesLoaded" data-testid="board">
      <BoardView
        :key="`${shown.id}:${shown.nonce}`"
        :sdk="sdk"
        :data="shown.data"
        :view="views[shown.id]"
        :mode="mode"
        :save-state="saveState"
        :save="save"
        :toolbar="toolbar"
        :palette="palette"
        @view="rememberView"
        @state="saveState = $event"
        @size="bytes = $event"
        @dirty="setDirty"
        @pictures="pictures = $event"
        @empty="empty = $event"
        @copy-shortcut="copyAsPicture"
        @pictures-loaded="picturesLoaded = $event"
        @notice="notify"
        @controls="setControls"
        @toolbar="placeToolbar"
        @palette="placePalette"
      />
      <EmptyState v-if="empty" :title="t('empty.hint')" class="text-muted-foreground pointer-events-none absolute top-1/2 left-1/2 z-[1] w-max max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 border-0 bg-transparent p-0" data-testid="empty-hint" />
    </main>
    <Toaster />
  </div>
</template>
