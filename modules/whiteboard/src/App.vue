<script setup lang="ts">
// The Whiteboard: a header with the board menu and the picture buttons, and the board below. Every Whiteboard panel of
// a workspace shows the same boards; which board a panel shows, its views and where its palette sits are its own state.
// This page only shows: the boards are the library's (board-library.ts), the open board's drawing and saving the
// board session's (boardSession.ts).
import { connectModule, errorMessage } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { ArrowLeftRight, ArrowRight, ImagePlus, Minus, MoreHorizontal, Plus, StickyNote, Waypoints } from "@lucide/vue";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { toast, Toaster } from "@tavora/official-ui/components/ui/toast";
import { TavoraError, type TavoraSDK, type TavoraTheme } from "@tavora/sdk";
import type { DocumentHandle } from "@tavora/sdk/store";
import { computed, defineAsyncComponent, h, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import BoardMenu from "./BoardMenu.vue";
import { openBoardLibrary, type BoardKind, type BoardLibrary } from "./board-library";
import { initialBoardState, type BoardState, type View } from "./boardState";
import type { BoardSession } from "./boardSession";
import { cleanName, emptyBoard, formatMegabytes, MAX_BOARD_BYTES, newBoardId, sizeLevel, type BoardData, type BoardSummary } from "./boards";
import { pictureName } from "./copy";
import { setLanguage, t } from "./i18n";
import { de, en } from "./locales";
import { DEFAULT_PALETTE, palettePlace, type PalettePlace } from "./palette";
import { unusedFiles } from "./pictures";
import { toolbarPlace, type ToolbarPlace } from "./toolbar";
import type { ConnectorKind } from "./connectors";

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
  document: DocumentHandle<BoardData>;
  /** Bumped to show the board again from what is stored (another panel changed it). */
  nonce: number;
}

/** How long a notice (and the Undo offer) stays when left alone. */
const NOTICE_MS = 10_000;

const sdk = shallowRef<TavoraSDK | null>(null);
const library = shallowRef<BoardLibrary | null>(null);
const error = ref<string | null>(null);
const mode = ref<"light" | "dark">("dark");
const list = shallowRef<BoardSummary[]>([]);
const shown = shallowRef<Shown | null>(null);
/** The open board's session and what it reports; null while the board loads. */
const board = shallowRef<BoardSession | null>(null);
const boardState = shallowRef<BoardState>(initialBoardState(emptyBoard()));
const deleted = ref(false);
const copying = ref(false);
// Panel state crosses a MessagePort; keep this object plain rather than sending a Vue proxy.
const palette = shallowRef<PalettePlace>(DEFAULT_PALETTE);
const toolbar = ref<ToolbarPlace>("top");
const pictureInput = ref<HTMLInputElement | null>(null);
const creatingBoard = ref(false);
const screenshotInput = ref<HTMLInputElement | null>(null);
const fitBoardId = ref<string | null>(null);
const connectorOpen = ref(false);
let connectorChoice: ConnectorKind | null = null;

let views: Record<string, View> = {};
let viewTimer: ReturnType<typeof setTimeout> | undefined;
let stopSession: (() => void) | undefined;
const cleanup: (() => void)[] = [];

const level = computed(() => sizeLevel(boardState.value.bytes));
const name = computed(() => list.value.find((entry) => entry.id === shown.value?.id)?.name ?? "");

/** A short message to the user, such as a picture that cannot be kept. */
function notify(message: string) {
  toast({ title: message, duration: NOTICE_MS });
}

/** A message with an Undo button. */
function offerUndo(message: string, run: () => Promise<void>) {
  toast({ title: message, duration: NOTICE_MS, action: { label: t("undo.undo"), onClick: () => void run().catch(() => undefined) } });
}

function saveSelection() {
  void sdk.value?.panel.setState({ selected: shown.value?.id ?? null, views, palette: palette.value } as unknown as never).catch(() => undefined);
}

/** Shows the library's open board; `again` shows the same board anew, from what another panel saved. */
function show(again: boolean) {
  const open = library.value?.current;
  const id = library.value?.currentId;
  if (!open || !id) {
    shown.value = null;
    return;
  }
  board.value = null;
  boardState.value = initialBoardState(open.data);
  shown.value = { id, document: open, nonce: (shown.value?.nonce ?? 0) + 1 };
  if (!again) saveSelection();
}

/** The board's session arrives once its view has mounted, and goes when the view does. */
function sessionOpened(session: BoardSession) {
  stopSession?.();
  board.value = session;
  boardState.value = session.state;
  library.value?.attach(session);
  const offs = [session.onState((next) => (boardState.value = next)), session.onNotice(notify), session.onCopyShortcut(() => void copyAsPicture())];
  stopSession = () => offs.forEach((off) => off());
}

function sessionClosed(session: BoardSession) {
  library.value?.detach(session);
  if (board.value !== session) return;
  stopSession?.();
  stopSession = undefined;
  board.value = null;
}

// What the board was last scrolled to is remembered for this panel.
watch(
  () => boardState.value.view,
  (view) => view && rememberView(view),
);

async function createBoard(kind: BoardKind = "blank") {
  if (kind === "screenshot") { screenshotInput.value?.click(); return; }
  const lib = library.value;
  if (!lib || creatingBoard.value) return;
  creatingBoard.value = true;
  try {
    const data = kind === "idea" ? (await import("./starters")).ideaBoard() : undefined;
    // The id is needed before the board opens: only a starter is fitted to the view once.
    const id = newBoardId();
    fitBoardId.value = kind === "idea" ? id : null;
    await lib.create(kind, data, id);
  } catch (reason) { notify(t("starter.failed", { error: errorMessage(reason) })); }
  finally { creatingBoard.value = false; }
}

async function createScreenshot(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  const lib = library.value;
  const connected = sdk.value;
  if (!file || !lib || !connected || creatingBoard.value) return;
  creatingBoard.value = true;
  try {
    const { readBoardPicture } = await import("./readPicture");
    const picture = await readBoardPicture(file);
    const blob = await connected.blobs.put(picture.blob);
    const data = (await import("./starters")).screenshotBoard(picture, blob.id);
    const id = newBoardId();
    fitBoardId.value = id;
    await lib.create("screenshot", data, id);
  } catch (reason) { notify(t("starter.failed", { error: errorMessage(reason) })); }
  finally { creatingBoard.value = false; }
}

async function select(id: string) {
  try {
    await library.value?.open(id);
  } catch (reason) {
    // A board another panel deleted meanwhile is gone from the list already.
    if (!(reason instanceof Error && reason.name === "ItemNotFoundError")) notify(t("save.error"));
  }
}

onMounted(async () => {
  try {
    const connection = await connectModule({ texts: { en, de } });
    if (connection.status !== "ready" || !connection.sdk) throw connection.error;
    const connected = connection.sdk;
    // The components read the module's own translator; it follows the language the handle reports.
    setLanguage(connection.language);
    cleanup.push(connection.onLanguage(setLanguage), connection.dispose);
    // The board needs the mode for Excalidraw; the shared styles already follow the theme.
    const modeOf = (theme: TavoraTheme | undefined) => (theme?.mode === "light" ? "light" : "dark");
    mode.value = modeOf(connection.theme);
    cleanup.push(connection.onTheme((theme) => (mode.value = modeOf(theme))));
    sdk.value = connected;
    // Where the toolbar goes is one choice for every workspace.
    toolbar.value = toolbarPlace(await connected.storage.app.get("toolbar").catch(() => null));

    const state = await connected.panel.getState<PanelState>();
    views = state?.views && typeof state.views === "object" ? state.views : {};
    palette.value = palettePlace(state?.palette);

    const lib = await openBoardLibrary(connected, { words: () => ({ board: t("boardWord"), idea: t("starter.idea"), screenshot: t("starter.screenshotName") }) });
    cleanup.push(() => void lib.dispose());
    library.value = lib;
    list.value = lib.boards;
    // Another panel (or this one) changed the boards, or the open one.
    cleanup.push(
      lib.onChange((event) => {
        if (event.type === "list") list.value = lib.boards;
        else if (event.type === "current") {
          deleted.value = lib.deleted;
          if (event.source === "pick") show(false);
          // This panel has nothing unsaved, so it takes over what the other panel saved.
          else if (event.source === "remote" && !event.deleted && !boardState.value.dirty) show(true);
        }
      }),
    );
    show(false);

    // Pictures that no board uses any more (of a deleted board, or taken off a board) are cleared out when a panel opens.
    void (async () => {
      const used = await lib.usedFiles();
      for (const file of unusedFiles(await connected.blobs.list(), used)) await connected.blobs.delete(file.id);
    })().catch(() => undefined);
  } catch (reason) {
    error.value = errorMessage(reason);
  }
});

onBeforeUnmount(() => cleanup.forEach((fn) => fn()));

function rememberView(view: View) {
  const id = shown.value?.id;
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
  const next = cleanName(value);
  if (!id || !library.value || !next || next === name.value) return;
  try {
    await library.value.rename(id, next);
  } catch {
    notify(t("board.renameFailed"));
  }
}

/** Runs a picture action from a click or key press; the host only takes the picture right after that press. */
async function pictureAction(run: (session: BoardSession) => Promise<void>, failed: (reason: unknown) => string) {
  const session = board.value;
  if (!session || copying.value) return;
  copying.value = true;
  try {
    await run(session);
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
    async (session) => {
      const copied = await session.copyAsPicture();
      notify(t(copied === "selection" ? "copy.selection" : "copy.board"));
    },
    (reason) => pictureProblem(reason, "copy.failed"),
  );
}

/** Save as picture: the same picture as Copy as picture, handed to Tavora's save dialog right after the click. */
function saveAsPicture() {
  return pictureAction(
    async (session) => {
      const saved = await session.saveAsPicture(pictureName(name.value || t("boardWord")));
      if (saved) notify(t(saved.what === "selection" ? "savePicture.selection" : "savePicture.board", { name: saved.fileName }));
    },
    (reason) => pictureProblem(reason, "savePicture.failed"),
  );
}

/** Clear board: everything off the board, with Undo in the notice (Ctrl+Z works too). */
function clearBoard() {
  const restore = board.value?.clear();
  if (restore) offerUndo(t("clear.done"), async () => restore());
}

async function remove() {
  const id = shown.value?.id;
  if (!id || !library.value) return;
  const label = name.value;
  let undo: () => Promise<void>;
  try {
    undo = await library.value.remove(id);
  } catch {
    notify(t("board.deleteFailed"));
    return;
  }
  delete views[id];
  offerUndo(t("undo.deleted", { name: label }), undo);
}

/** The board was deleted in another panel: bring it back as this panel last saw it. */
async function restore() {
  try {
    await library.value?.restoreDeleted();
  } catch (reason) {
    notify(t("deleted.restoreFailed", { error: errorMessage(reason) }));
  }
}

function reload() {
  location.reload();
}

function togglePictureLocks() {
  board.value?.setPicturesLocked(!boardState.value.pictures.allLocked);
}

function addNote() { board.value?.addNote(); }
function setConnector(kind: ConnectorKind) { connectorChoice = kind; connectorOpen.value = false; }
function finishConnector(event: Event) {
  if (!connectorChoice) return;
  event.preventDefault();
  const kind = connectorChoice;
  connectorChoice = null;
  board.value?.setConnector(kind);
}
function setGrid(enabled: boolean) { board.value?.setGrid(enabled); }

async function addPicture(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !board.value) return;
  try { await board.value.addPicture(file); }
  catch (reason) { notify(t("card.failed", { error: errorMessage(reason) })); }
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
  <div v-else class="whiteboard-app flex h-full min-h-0 flex-col" data-testid="whiteboard-app">
    <header class="board-bar bg-primary/5 border-primary/25 flex flex-none items-center gap-2 border-b px-2 py-1">
      <div class="board-switcher">
        <BoardMenu
          :boards="list"
          :current-id="shown.id"
          :current-name="name"
          :can-clear="!boardState.empty"
          :grid="boardState.grid"
          :ready="boardState.ready"
          :creating="creatingBoard"
          @select="select"
          @create="createBoard"
          @rename="rename"
          @clear="clearBoard"
          @delete="remove"
          @grid="setGrid"
        />
      </div>
      <span class="flex-1" />
      <DropdownMenu v-model:open="connectorOpen">
        <DropdownMenuTrigger as-child><Button variant="ghost" size="sm" :disabled="!boardState.ready" :aria-label="t('connector.button')" :title="t('connector.button')" data-testid="connector-menu"><Waypoints class="size-4" aria-hidden="true" /><span class="toolbar-label">{{ t("connector.button") }}</span></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" @close-auto-focus="finishConnector">
          <DropdownMenuItem data-testid="connector-line" @select="setConnector('line')"><Minus class="size-4" aria-hidden="true" />{{ t("connector.line") }}</DropdownMenuItem>
          <DropdownMenuItem data-testid="connector-one-way" @select="setConnector('one-way')"><ArrowRight class="size-4" aria-hidden="true" />{{ t("connector.one") }}</DropdownMenuItem>
          <DropdownMenuItem data-testid="connector-two-way" @select="setConnector('two-way')"><ArrowLeftRight class="size-4" aria-hidden="true" />{{ t("connector.two") }}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="sm" :disabled="!boardState.ready" data-testid="add-card" :aria-label="t('card.add')" :title="t('card.add')"><Plus class="size-4" aria-hidden="true" /><span class="toolbar-label">{{ t("card.add") }}</span></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem data-testid="add-note-card" @select="addNote"><StickyNote class="size-4" aria-hidden="true" />{{ t("card.note") }}</DropdownMenuItem>
          <DropdownMenuItem data-testid="add-picture-card" @select="pictureInput?.click()"><ImagePlus class="size-4" aria-hidden="true" />{{ t("card.picture") }}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input ref="pictureInput" class="hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-testid="card-file" :aria-label="t('card.picture')" @change="addPicture" />
      <input ref="screenshotInput" class="hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-testid="starter-file" :aria-label="t('starter.screenshot')" @change="createScreenshot" />
      <Button
        v-if="boardState.pictures.count > 0"
        type="button"
        variant="ghost"
        size="sm"
        class="board-image-action text-muted-foreground"
        :title="t(boardState.pictures.allLocked ? 'image.unlockHint' : 'image.lockHint')"
        data-testid="picture-lock"
        :data-locked="boardState.pictures.allLocked"
        @click="togglePictureLocks"
      >
        {{ t(boardState.pictures.allLocked ? "image.unlock" : "image.lock") }}
      </Button>
      <Button class="board-image-action" type="button" variant="outline" size="sm" :title="t('copy.hint')" data-testid="copy-picture" :disabled="boardState.empty || copying" @click="copyAsPicture">{{ t("copy.button") }}</Button>
      <Button class="board-image-action" type="button" variant="outline" size="sm" :title="t('savePicture.hint')" data-testid="save-picture" :disabled="boardState.empty || copying" @click="saveAsPicture">{{ t("savePicture.button") }}</Button>
      <DropdownMenu>
        <DropdownMenuTrigger as-child><Button class="board-actions-menu" variant="ghost" size="icon-sm" :aria-label="t('board.actions')" :title="t('board.actions')" data-testid="board-actions"><MoreHorizontal class="size-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem data-testid="compact-copy-picture" :disabled="boardState.empty || copying" @select="copyAsPicture">{{ t("copy.button") }}</DropdownMenuItem>
          <DropdownMenuItem data-testid="compact-save-picture" :disabled="boardState.empty || copying" @select="saveAsPicture">{{ t("savePicture.button") }}</DropdownMenuItem>
          <DropdownMenuSeparator v-if="boardState.pictures.count > 0" />
          <DropdownMenuItem v-if="boardState.pictures.count > 0" @select="togglePictureLocks">{{ t(boardState.pictures.allLocked ? "image.unlock" : "image.lock") }}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
    <Notice v-if="deleted" variant="warning" class="mx-2 mt-2 flex-none" data-testid="board-deleted">
      {{ t("deleted.notice") }}
      <template #action>
        <Button type="button" size="sm" variant="secondary" data-testid="board-restore" @click="restore">{{ t("deleted.restore") }}</Button>
      </template>
    </Notice>
    <Notice v-if="level !== 'ok'" :variant="level === 'full' ? 'error' : 'warning'" class="mx-2 mt-2 flex-none" data-testid="board-size">
      {{ t(level === "full" ? "size.full" : "size.warn", { used: formatMegabytes(boardState.bytes), max: formatMegabytes(MAX_BOARD_BYTES) }) }}
    </Notice>
    <main class="relative min-h-0 flex-1" :data-board="shown.id" :data-pictures="boardState.picturesLoaded" data-testid="board">
      <BoardView
        :key="`${shown.id}:${shown.nonce}`"
        :sdk="sdk"
        :document="shown.document"
        :view="views[shown.id]"
        :mode="mode"
        :toolbar="toolbar"
        :palette="palette"
        :fit-on-open="fitBoardId === shown.id"
        @session="sessionOpened"
        @closed="sessionClosed"
        @toolbar="placeToolbar"
        @palette="placePalette"
      />
      <EmptyState v-if="boardState.empty" :title="t('empty.hint')" class="text-muted-foreground pointer-events-none absolute top-1/2 left-1/2 z-[1] w-max max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 border-0 bg-transparent p-0" data-testid="empty-hint" />
    </main>
    <Toaster />
  </div>
</template>
