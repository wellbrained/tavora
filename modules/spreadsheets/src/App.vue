<script setup lang="ts">
// Spreadsheets: a toolbar, the formula bar, the grid and the sheet tabs. Every panel of a workspace sees the same
// spreadsheets; which one is open, its sheet, the selected cell, the scroll and the live-view range are this panel's
// own, saved with its panel state and read back when it starts.
import { Table2 } from "@lucide/vue";
import { connectModule, errorMessage, flushViewMemory, NameDialog } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { cell, rangeOf, single, type GridEdit, type GridScroll, type GridSelection } from "@tavora/official-ui/components/ui/data-grid";
import { settingsDialogSize } from "@tavora/official-ui/components/ui/module-settings";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import { Skeleton } from "@tavora/official-ui/components/ui/skeleton";
import { handleUndoKey, toast, Toaster, undoable, type Undoable } from "@tavora/official-ui/components/ui/toast";
import type { JsonValue, MenuOptions, TavoraSDK } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from "vue";
import { PANEL, type GridApi } from "./context";
import { inputToStored } from "./display";
import { readCsv, writeCsv } from "./csv";
import FormulaBar from "./FormulaBar.vue";
import type { Lang } from "./formula/locale";
import { cellName, parseCellName, parseRangeName, rangeName } from "./formula/refs";
import DropdownDialog from "./DropdownDialog.vue";
import { plural, setLanguage, t, language } from "./i18n";
import { buildLiveState, LIVE_DEFAULTS, parseLook, type LiveCell, type LiveLook, type LiveState } from "./live";
import { de, en } from "./locales";
import { LIMITS, TooBig, documentBytes, formatAt, parseSpreadsheet, sheetById, styleAt, usedSize, type DropdownOption, type SheetRange, type SpreadsheetData } from "./model";
import { createSession, type Refusal, type Session } from "./session";
import Settings from "./Settings.vue";
import SheetGrid from "./SheetGrid.vue";
import SheetTabs from "./SheetTabs.vue";
import SortDialog from "./SortDialog.vue";
import { createSpreadsheets, newId, TooLarge, type SpreadsheetHandle, type Spreadsheets } from "./store";
import { hiddenRows } from "./table";
import { buildTemplate, TEMPLATES, todaySerial, type TemplateId } from "./templates";
import Toolbar from "./Toolbar.vue";

interface PanelState {
  spreadsheet: string | null;
  sheet: string | null;
  cell: string;
  scroll: GridScroll;
  /** This panel's own live-view range; null uses the spreadsheet's. */
  live: SheetRange | null;
  /** The live view was turned off in this panel. */
  liveOff: boolean;
  look: LiveLook;
}

const sdk = shallowRef<TavoraSDK | null>(null);
const book = shallowRef<Spreadsheets | null>(null);
const session = shallowRef<Session | null>(null);
const error = ref<string | null>(null);
const opening = ref(false);
const currentId = ref<string | null>(null);
const selection = ref<GridSelection>(single(cell(0, 0)));
const editing = ref<GridEdit | null>(null);
const scroll = ref<GridScroll>({ top: 0, left: 0 });
const grid = shallowRef<GridApi | null>(null);
const panelLive = shallowRef<SheetRange | null>(null);
const liveOff = ref(false);
const look = shallowRef<LiveLook>({ ...LIVE_DEFAULTS });
const savedAt = ref<number>();
const dialogOpen = ref(false);
const lang = computed<Lang>(() => (language.value.toLowerCase().startsWith("de") ? "de" : "en"));
const range = computed(() => rangeOf(selection.value));
const spreadsheets = computed(() => book.value?.list.value ?? []);

// ── Open spreadsheets: each keeps its handle and undo history while the panel lives

const open = new Map<string, { handle: SpreadsheetHandle; session: Session; stop: () => void }>();

async function show(id: string, restore?: Pick<PanelState, "sheet" | "cell" | "scroll">): Promise<void> {
  const list = book.value;
  if (!list) return;
  if (grid.value && editing.value) grid.value.commitEdit();
  opening.value = true;
  try {
    let entry = open.get(id);
    if (!entry) {
      const handle = await list.open(id);
      const created = createSession(handle, { lang, texts: () => ({ yes: t("value.true"), no: t("value.false") }) });
      const stop = handle.onError((reason, kind) => {
        if (kind === "save") toast({ title: t("saveError", { error: errorMessage(reason) }), variant: "error" });
      });
      entry = { handle, session: created, stop };
      open.set(id, entry);
    }
    if (restore?.sheet && sheetById(entry.session.doc.value, restore.sheet)) entry.session.sheetId.value = restore.sheet;
    const at = restore?.cell ? parseCellName(restore.cell) : null;
    selection.value = single(cell(at?.row ?? 0, at?.col ?? 0));
    scroll.value = restore?.scroll ?? { top: 0, left: 0 };
    editing.value = null;
    session.value = entry.session;
    currentId.value = id;
    savePanel();
  } catch (reason) {
    toast({ title: errorMessage(reason), variant: "error" });
  } finally {
    opening.value = false;
  }
}

async function close(id: string) {
  const entry = open.get(id);
  if (!entry) return;
  open.delete(id);
  entry.stop();
  entry.session.dispose();
  await entry.handle.dispose();
}

// ── Panel state

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function panelState(): PanelState {
  return {
    spreadsheet: currentId.value,
    sheet: session.value?.sheetId.value ?? null,
    cell: cellName(selection.value.active.row, selection.value.active.col),
    scroll: { top: Math.round(scroll.value.top), left: Math.round(scroll.value.left) },
    live: panelLive.value ? { ...panelLive.value } : null,
    liveOff: liveOff.value,
    look: { ...look.value },
  };
}
function savePanel(now = false) {
  clearTimeout(saveTimer);
  const write = () => void sdk.value?.panel.setState(panelState() as unknown as JsonValue).catch(() => undefined);
  if (now) write();
  else saveTimer = setTimeout(write, 400);
}
watch([selection, scroll, () => session.value?.sheetId.value], () => savePanel(), { deep: true });

/** Saves what is waiting: the panel's own state and every open spreadsheet. */
async function flushAll() {
  if (grid.value && editing.value) grid.value.commitEdit();
  savePanel(true);
  flushViewMemory();
  await Promise.all([...open.values()].map((entry) => entry.handle.flush()));
}

// ── Messages

function refused(refusal: Refusal | null) {
  if (!refusal || refusal.kind === "nothing") return;
  if (refusal.kind === "kept") toast({ title: plural("kept", refusal.count), duration: 5000 });
  else toast({ title: t("tooFit"), description: t(`limit.${refusal.limit}`), variant: "error", duration: 6000 });
}

function tooBig(limit: "rows" | "cols" | "sheets" | "bytes") {
  toast({ title: t("tooBig"), description: t(`limit.${limit}`), variant: "error", duration: 6000 });
}

// ── Making, copying and deleting spreadsheets

/** A name no other spreadsheet has: "Farming list", then "Farming list 2". */
function freeName(base: string): string {
  const taken = new Set(spreadsheets.value.map((entry) => entry.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

async function add(data: SpreadsheetData): Promise<void> {
  const id = newId();
  try {
    await book.value!.put(id, data);
    await show(id);
  } catch (reason) {
    if (reason instanceof TooLarge) tooBig("bytes");
    else toast({ title: errorMessage(reason), variant: "error" });
  }
}

function create(template: TemplateId) {
  const data = buildTemplate(template, (key) => t(key as never), new Date().toISOString(), todaySerial());
  data.name = freeName(data.name);
  void add(data);
}

function duplicate() {
  const current = session.value;
  if (!current) return;
  const data = structuredClone(current.doc.value) as SpreadsheetData;
  data.name = freeName(t("copyName", { name: data.name }));
  data.createdAt = new Date().toISOString();
  void add(data);
}

const offers = new Set<Undoable>();

/** Deletes the open spreadsheet at once; Undo on the toast puts it back with the same id, as it was. */
async function remove() {
  const id = currentId.value;
  const current = session.value;
  if (!id || !current) return;
  await open.get(id)?.handle.flush();
  const data = structuredClone(current.doc.value) as SpreadsheetData;
  const name = data.name;
  await close(id);
  await book.value!.remove(id);
  const next = spreadsheets.value[0];
  session.value = null;
  currentId.value = null;
  if (next) await show(next.id);
  else savePanel();
  const offer = undoable({
    title: t("deleted", { name }),
    undo: async () => {
      if (spreadsheets.value.some((entry) => entry.id === id)) return false;
      await book.value!.put(id, data);
      await show(id);
    },
    onFinal: () => offers.delete(offer),
  });
  offers.add(offer);
}

// ── Dialogs

const renaming = ref(false);
const editingOptions = ref(false);
const sorting = ref(false);

function openDialog(kind: "rename" | "dropdown" | "sort") {
  if (kind === "rename") renaming.value = true;
  else if (kind === "dropdown") editingOptions.value = true;
  else sorting.value = true;
}

const dropdownOptions = computed<DropdownOption[]>(() => {
  const current = session.value;
  if (!current) return [];
  void current.version.value;
  const format = current.formatOf(selection.value.active.row, selection.value.active.col);
  if (format.type === "dropdown") return format.options;
  // A new dropdown starts with what the selected cells already hold.
  const seen = new Set<string>();
  for (let row = range.value.top; row <= Math.min(range.value.bottom, range.value.top + 200); row++) {
    for (let col = range.value.left; col <= range.value.right; col++) {
      const shown = current.shownAt(row, col).trim();
      if (shown && seen.size < 20) seen.add(shown);
    }
  }
  return [...seen].map((value) => ({ value, color: null }));
});

const headerNames = computed(() => {
  const current = session.value;
  if (!current) return [];
  void current.version.value;
  if (!current.sheet.value.header) return [];
  return Array.from({ length: Math.max(1, current.used.value.cols) }, (_, col) => current.shownAt(0, col));
});

function rename(name: string) {
  session.value?.rename(name.trim().slice(0, LIMITS.name));
  renaming.value = false;
}

// ── Files

const baseName = (fileName: string) => fileName.replace(/\.[^.]+$/, "").slice(0, LIMITS.name) || t("tpl.blank.name");

async function runFileAction(id: string) {
  const api = sdk.value;
  const current = session.value;
  if (!api) return;
  try {
    if (id === "file.save" && current) {
      const saved = await api.files.saveJson(current.doc.value as unknown as JsonValue, current.doc.value.name);
      if (saved) toast({ title: t("savedAs", { name: saved.fileName }) });
    } else if (id === "file.open") {
      const opened = await api.files.openJson();
      if (!opened) return;
      const value = opened.value as { sheets?: unknown };
      if (typeof value !== "object" || value === null || !Array.isArray(value.sheets)) return void toast({ title: t("notTavora"), variant: "error" });
      const data = parseSpreadsheet(opened.value);
      if (data.sheets.length > LIMITS.sheets) return tooBig("sheets");
      data.name = freeName(data.name || baseName(opened.fileName));
      await add(data);
      toast({ title: t("imported", { name: data.name }) });
    } else if (id === "csv.import" && current) {
      if (!api.supports("files.open")) return void toast({ title: t("needsNewer"), variant: "error" });
      const opened = await api.files.open({ types: ["csv"] });
      if (!opened || opened.type !== "csv") return;
      const table = readCsv(opened.text, lang.value);
      if (table.rows.length > LIMITS.rows) return tooBig("rows");
      if (Math.max(0, ...table.rows.map((row) => row.length)) > LIMITS.cols) return tooBig("cols");
      const cells: Record<string, string> = {};
      table.rows.forEach((row, r) =>
        row.forEach((text, c) => {
          const raw = inputToStored(text, { type: "auto" }, table.lang).raw;
          if (raw) cells[cellName(r, c)] = raw;
        }),
      );
      const refusal = current.addFilledSheet(`s-${crypto.randomUUID().slice(0, 8)}`, baseName(opened.fileName), cells);
      if (refusal?.kind === "tooBig") return tooBig(refusal.limit);
      toast({ title: t("imported", { name: opened.fileName }) });
    } else if (id === "csv.export" && current) {
      if (!api.supports("files.save")) return void toast({ title: t("needsNewer"), variant: "error" });
      const size = usedSize(current.sheet.value);
      const rows = Array.from({ length: size.rows }, (_, row) => Array.from({ length: size.cols }, (_, col) => current.shownAt(row, col)));
      await api.files.save(writeCsv(rows, lang.value), { type: "csv", name: `${current.doc.value.name} - ${current.sheet.value.name}` });
    } else if (id === "xlsx.import") {
      if (!api.supports("files.open")) return void toast({ title: t("needsNewer"), variant: "error" });
      const opened = await api.files.open({ types: ["xlsx"] });
      if (!opened || opened.type !== "xlsx") return;
      const { readXlsx } = await import("./xlsx");
      let sheets;
      try {
        sheets = await readXlsx(opened.bytes, (index) => `${t("sheet.base")}${index + 1}`);
      } catch (reason) {
        if (reason instanceof TooBig) return tooBig(reason.limit);
        return void toast({ title: t("cantOpen"), description: t("saveXlsx"), variant: "error" });
      }
      const data: SpreadsheetData = { version: 1, name: freeName(baseName(opened.fileName)), sheets, live: null, createdAt: new Date().toISOString() };
      if (documentBytes(data) > LIMITS.bytes) return tooBig("bytes");
      await add(data);
      toast({ title: t("imported", { name: opened.fileName }) });
    } else if (id === "xlsx.export" && current) {
      if (!api.supports("files.save")) return void toast({ title: t("needsNewer"), variant: "error" });
      const { writeXlsx } = await import("./xlsx");
      const bytes = await writeXlsx(current.doc.value, (sheet, row, col) => current.engine.value(sheet, row, col));
      await api.files.save(bytes, { type: "xlsx", name: current.doc.value.name });
    }
  } catch (reason) {
    toast({ title: errorMessage(reason), variant: "error" });
  }
}

function openLink(url: string) {
  const address = url.trim();
  if (!/^https?:\/\//i.test(address)) return void toast({ title: t("linkBad"), variant: "error", duration: 4000 });
  void sdk.value?.links.open(address).catch((reason) => toast({ title: errorMessage(reason), variant: "error" }));
}

// ── Live view: what Tavora shows over the game while the panel is closed

const liveRange = computed<SheetRange | null>(() => {
  if (liveOff.value || !session.value) return null;
  void session.value.version.value;
  const target = panelLive.value ?? session.value.doc.value.live;
  return target && sheetById(session.value.doc.value, target.sheet) ? target : null;
});
const liveOn = computed(() => liveRange.value !== null);
const showing = computed(() => {
  const target = liveRange.value;
  const current = session.value;
  if (!target || !current) return null;
  return t("live.range", { range: target.range, sheet: sheetById(current.doc.value, target.sheet)?.name ?? "" });
});

const liveState = computed<LiveState | null>(() => {
  const current = session.value;
  const target = liveRange.value;
  if (!current || !target) return null;
  void current.version.value;
  void lang.value;
  const sheet = sheetById(current.doc.value, target.sheet)!;
  const area = parseRangeName(target.range);
  if (!area) return null;
  const bottom = Math.min(area.bottom, area.top + 200);
  const hidden = hiddenRows(sheet.filter, sheet.header ? 1 : 0, bottom + 1, (row, col) => current.shownAt(row, col, sheet.id), (row, col) => current.valueAt(row, col, sheet.id));
  const rows: LiveCell[][] = [];
  for (let row = area.top; row <= bottom; row++) {
    if (hidden.has(row)) continue;
    const line: LiveCell[] = [];
    for (let col = area.left; col <= area.right; col++) {
      const style = styleAt(sheet, row, col);
      const format = formatAt(sheet, row, col);
      const shown = current.shownAt(row, col, sheet.id);
      const value = current.valueAt(row, col, sheet.id);
      const item: LiveCell = { t: shown };
      if (style.bold) item.b = true;
      if (style.italic) item.i = true;
      const align = style.align ?? (format.type === "checkbox" ? "center" : typeof value === "number" ? "right" : "left");
      if (align !== "left") item.a = align === "center" ? "c" : "r";
      if (style.color) item.c = style.color;
      if (style.fill) item.f = style.fill;
      if (format.type === "checkbox" && current.rawAt(row, col, sheet.id) !== undefined) {
        item.k = "check";
        if (value === true) item.v = true;
      } else if (format.type === "dropdown") {
        item.k = "pill";
        const option = format.options.find((entry) => entry.value === shown);
        if (option?.color) item.p = option.color;
      }
      line.push(item);
    }
    rows.push(line);
  }
  const widths = Array.from({ length: area.right - area.left + 1 }, (_, index) => sheet.colWidths[area.left + index] ?? 96);
  return buildLiveState({ rows, widths, header: sheet.header && area.top === 0, look: look.value, moreText: t("live.more", { count: "{count}" }) });
});

let liveTimer: ReturnType<typeof setTimeout> | undefined;
watch([liveState, sdk], () => {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => void sdk.value?.panel.setLive(liveState.value as unknown as JsonValue).catch(() => undefined), 250);
});

function showInGame(on: boolean) {
  const current = session.value;
  if (!current) return;
  liveOff.value = !on;
  if (on) {
    let area = range.value;
    // One cell picked: the whole used part of the sheet.
    if (area.top === area.bottom && area.left === area.right) {
      const size = current.used.value;
      area = { top: 0, left: 0, bottom: Math.max(0, size.rows - 1), right: Math.max(0, size.cols - 1) };
    }
    panelLive.value = { sheet: current.sheetId.value, range: rangeName(area) };
  }
  savePanel(true);
  savedAt.value = Date.now();
}

function setLook(next: LiveLook) {
  look.value = next;
  savePanel(true);
  savedAt.value = Date.now();
}

function openSettings() {
  void sdk.value?.panel.openDialog(settingsDialogSize({ pages: 2 })).catch((reason) => toast({ title: errorMessage(reason), variant: "error" }));
}

// ── Keys outside the grid

function onKey(event: KeyboardEvent) {
  // Ctrl+Z takes back a deleted spreadsheet while its toast is up; in the grid it is the sheet's own undo.
  if (offers.size && handleUndoKey(event)) {
    event.preventDefault();
    return;
  }
  const inPopup = (event.target as Element | null)?.closest?.("[role=listbox], [role=menu], [role=dialog]");
  if (event.key === "Escape" && dialogOpen.value && !event.defaultPrevented && !inPopup) void sdk.value?.panel.closeDialog();
}

provide(PANEL, {
  session,
  lang,
  selection,
  range,
  editing,
  grid,
  spreadsheets,
  currentId,
  showMenu: (request: MenuOptions) => sdk.value?.ui.showMenu(request) ?? Promise.resolve(null),
  refused,
  openDialog,
  open: (id) => void show(id),
  create,
  duplicate,
  remove: () => void remove(),
  runFileAction: (id) => void runFileAction(id),
  showInGame,
  openSettings,
  liveOn,
});

const cleanup: (() => void)[] = [];
let ticker: ReturnType<typeof setInterval> | undefined;

onMounted(async () => {
  try {
    const connection = await connectModule({ texts: { en, de } });
    if (connection.status !== "ready" || !connection.sdk) throw connection.error;
    const connected = connection.sdk;
    setLanguage(connection.language);
    cleanup.push(connection.onLanguage(setLanguage), connection.dispose);
    const [state, list] = await Promise.all([connected.panel.getState<Partial<PanelState>>(), createSpreadsheets(connected)]);
    sdk.value = connected;
    book.value = list;
    cleanup.push(list.dispose);
    look.value = parseLook(state?.look);
    panelLive.value = state?.live && typeof state.live.sheet === "string" && typeof state.live.range === "string" && parseRangeName(state.live.range) ? { sheet: state.live.sheet, range: state.live.range } : null;
    liveOff.value = state?.liveOff === true;
    cleanup.push(
      connected.panel.onDialogChange((isOpen) => (dialogOpen.value = isOpen)),
      connected.lifecycle.onSuspend(() => {
        void flushAll();
        clearInterval(ticker);
      }),
      connected.lifecycle.onResume(() => startTicker()),
      connected.lifecycle.onDispose(() => void flushAll()),
    );
    addEventListener("keydown", onKey, true);
    cleanup.push(() => removeEventListener("keydown", onKey, true));
    const wanted = state?.spreadsheet && list.list.value.some((entry) => entry.id === state.spreadsheet) ? state.spreadsheet : list.list.value[0]?.id;
    if (wanted) await show(wanted, wanted === state?.spreadsheet ? { sheet: state?.sheet ?? null, cell: typeof state?.cell === "string" ? state.cell : "A1", scroll: state?.scroll ?? { top: 0, left: 0 } } : undefined);
    startTicker();
  } catch (reason) {
    error.value = errorMessage(reason);
  }
});

/** TODAY() and NOW() follow the clock, once a minute while the panel shows. */
function startTicker() {
  clearInterval(ticker);
  ticker = setInterval(() => session.value?.tick(), 60_000);
}

// Another panel deleted the open spreadsheet: show the next one.
watch(spreadsheets, (list) => {
  if (currentId.value && !list.some((entry) => entry.id === currentId.value) && !opening.value) {
    const gone = currentId.value;
    session.value = null;
    currentId.value = null;
    void close(gone);
    if (list[0]) void show(list[0].id);
  }
});

onBeforeUnmount(() => {
  void flushAll();
  clearInterval(ticker);
  clearTimeout(liveTimer);
  cleanup.forEach((fn) => fn());
  for (const offer of offers) offer.close();
  for (const id of [...open.keys()]) void close(id);
});
</script>

<template>
  <p v-if="error" class="p-4 text-sm text-destructive" role="alert">{{ t("connectError", { error }) }}</p>
  <Settings v-else-if="dialogOpen" :look="look" :state="liveState" :showing="showing" :saved-at="savedAt" @update:look="setLook" @use="showInGame(true)" @stop="showInGame(false)" />
  <div v-else class="flex h-full min-h-0 flex-col" data-testid="spreadsheets">
    <span class="sr-only" role="status">{{ !book ? t("loading") : "" }}</span>
    <template v-if="session">
      <Toolbar />
      <FormulaBar />
      <SheetGrid v-model:scroll="scroll" @open-link="openLink" />
      <SheetTabs />
    </template>
    <Skeleton v-else-if="!book || opening" :loading="true" class="flex min-h-0 flex-1 flex-col">
      <div class="flex h-11 items-center gap-2 border-b px-2"><Button size="sm" variant="secondary">{{ t("picker.label") }}</Button></div>
      <div class="min-h-0 flex-1" />
    </Skeleton>
    <div v-else class="flex flex-1 items-center justify-center p-4">
      <EmptyState class="w-full max-w-sm border-0" :title="t('empty.title')" :description="t('empty.text')" data-testid="empty">
        <template #icon><Table2 :stroke-width="1.5" /></template>
        <template #action>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button data-testid="new-spreadsheet">{{ t("new") }}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              <DropdownMenuItem v-for="template in TEMPLATES" :key="template" :data-testid="`first-${template}`" @select="create(template)">
                <Table2 :stroke-width="1.5" /> {{ template === "blank" ? t("new.blank") : t(`tpl.${template}.name`) }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </template>
      </EmptyState>
    </div>
  </div>
  <NameDialog v-if="renaming && session" :title="t('rename.title')" :label="t('rename.label')" :confirm="t('rename')" :cancel="t('cancel')" :value="session.doc.value.name" :max-length="LIMITS.name" @submit="rename" @cancel="renaming = false" />
  <DropdownDialog v-if="session" v-model:open="editingOptions" :options="dropdownOptions" @save="(options) => session!.formatRange(range, { type: 'dropdown', options })" />
  <SortDialog v-if="session" v-model:open="sorting" :columns="Math.max(1, session.used.value.cols)" :start="selection.active.col" :names="headerNames" @sort="(keys) => session!.sort(range, keys)" />
  <Toaster />
</template>
