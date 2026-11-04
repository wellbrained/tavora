<script setup lang="ts">
// The sheet itself: the kit's DataGrid with each cell drawn by its format (checkbox, dropdown pill, link, text), and
// everything the module adds to it: its keys (undo, bold, Space on a checkbox, Alt+↓ on a dropdown, Ctrl+;), copy
// and paste with other apps, fill, right-click menus, and the filter's ▾ in the header row.
import { ChevronDown, ListFilter } from "@lucide/vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { DataGrid, cell, fillShortcut, type CellPos, type FillPlan, type GridRange, type GridSelection, type GridScroll } from "@tavora/official-ui/components/ui/data-grid";
import { Popover, PopoverAnchor, PopoverContent } from "@tavora/official-ui/components/ui/popover";
import type { MenuEntry } from "@tavora/sdk";
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, watch, type HTMLAttributes } from "vue";
import { readClipboard, writeClipboard } from "./clipboard";
import { PANEL, type GridApi } from "./context";
import FilterPanel from "./FilterPanel.vue";
import { isError, isFormula } from "./formula/values";
import FunctionHints from "./FunctionHints.vue";
import { plural, t } from "./i18n";
import { LIMITS, type ColorName } from "./model";
import { isActive } from "./table";

const scroll = defineModel<GridScroll>("scroll", { required: true });
const emit = defineEmits<{ "open-link": [url: string] }>();

const panel = inject(PANEL)!;
const session = computed(() => panel.session.value!);
const sheet = computed(() => session.value.sheet.value);
const gridPart = shallowRef<GridApi | null>(null);
watch(gridPart, (api) => (panel.grid.value = api), { immediate: true });
onBeforeUnmount(() => {
  if (panel.grid.value === gridPart.value) panel.grid.value = null;
});

// Room to grow: the used part and a little more, and always a page past the active cell.
const rows = computed(() => Math.min(LIMITS.rows, Math.max(200, session.value.used.value.rows + 100, panel.selection.value.active.row + 60)));
const cols = computed(() => Math.min(LIMITS.cols, Math.max(26, session.value.used.value.cols + 5, panel.selection.value.active.col + 8)));

// ── Drawing cells

const TEXT: Record<ColorName, string> = { primary: "text-primary", destructive: "text-destructive", warning: "text-warning", success: "text-success", info: "text-info", "muted-foreground": "text-muted-foreground" };
const FILL: Record<ColorName, string> = { primary: "bg-primary/15", destructive: "bg-destructive/15", warning: "bg-warning/15", success: "bg-success/15", info: "bg-info/15", "muted-foreground": "bg-muted-foreground/15" };
const PILL: Record<ColorName, string> = { primary: "bg-primary/20 text-primary", destructive: "bg-destructive/20 text-destructive", warning: "bg-warning/20 text-warning", success: "bg-success/20 text-success", info: "bg-info/20 text-info", "muted-foreground": "bg-muted-foreground/20 text-foreground" };

// Every function the grid reads changes identity with the spreadsheet's version, so the grid draws again.
const text = computed(() => {
  void session.value.version.value;
  void panel.lang.value;
  return (row: number, col: number) => session.value.shownAt(row, col);
});
const editText = computed(() => {
  void session.value.version.value;
  return (row: number, col: number) => session.value.editTextAt(row, col);
});
const filled = computed(() => {
  void session.value.version.value;
  return (row: number, col: number) => session.value.rawAt(row, col) !== undefined;
});

const cellClass = computed(() => {
  void session.value.version.value;
  return (row: number, col: number): HTMLAttributes["class"] => {
    const style = session.value.styleOf(row, col);
    const value = session.value.valueAt(row, col);
    const format = session.value.formatOf(row, col);
    const align = style.align ?? (format.type === "checkbox" ? "center" : typeof value === "number" && format.type !== "text" ? "right" : "left");
    return [
      align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start",
      style.bold && "font-semibold",
      style.italic && "italic",
      style.wrap && "items-start whitespace-pre-wrap py-1",
      style.fill && FILL[style.fill],
      isError(value) ? "text-destructive" : style.color && TEXT[style.color],
    ];
  };
});

const cellTitle = computed(() => {
  void session.value.version.value;
  return (row: number, col: number) => {
    const value = session.value.valueAt(row, col);
    if (!isError(value) || value.error !== "#CYCLE!") return undefined;
    const loop = session.value.loopAt(row, col);
    return loop ? t("cycle", { cells: loop.join(" → ") }) : undefined;
  };
});

const kind = (row: number, col: number) => session.value.formatOf(row, col).type;
const pillColor = (row: number, col: number, shown: string): string => {
  const format = session.value.formatOf(row, col);
  const option = format.type === "dropdown" ? format.options.find((item) => item.value === shown) : undefined;
  return option?.color ? PILL[option.color] : "bg-muted text-foreground";
};
const showsFilter = (row: number, col: number) => row === 0 && sheet.value.header && !!sheet.value.filter && col < Math.max(1, session.value.used.value.cols);
const filterOn = (col: number) => {
  const filter = sheet.value.filter?.columns[col];
  return !!filter && isActive(filter);
};

// ── What the grid reports

const commit = (pos: CellPos, input: string) => session.value.commit(pos.row, pos.col, input);
const clear = (range: GridRange) => session.value.clear(range);
const fill = (plan: FillPlan) => panel.refused(session.value.fill(plan, "series"));
const resizeColumn = (col: number, width: number) => session.value.resize("col", col, width);
const resizeRow = (row: number, height: number) => session.value.resize("row", row, height);

function copy(range: GridRange, event: ClipboardEvent) {
  if (!event.clipboardData) return;
  event.preventDefault();
  writeClipboard(event.clipboardData, session.value.copy(range), { top: range.top, left: range.left });
}

function cut(range: GridRange, event: ClipboardEvent) {
  copy(range, event);
  session.value.clear(range);
}

function paste(selection: GridSelection, event: ClipboardEvent) {
  if (!event.clipboardData) return;
  event.preventDefault();
  const cells = readClipboard(event.clipboardData);
  if (!cells) return;
  const refusal = session.value.paste(selection.active, panel.range.value, cells);
  panel.refused(refusal);
  if (refusal) return;
  const height = cells.rows.length;
  const width = Math.max(...cells.rows.map((row) => row.length));
  const single = height === 1 && width === 1;
  if (!single) panel.selection.value = { active: { ...selection.active }, anchor: { ...selection.active }, focus: cell(selection.active.row + height - 1, selection.active.col + width - 1) };
}

// ── Keys the module adds

function onKey(event: KeyboardEvent) {
  const ctrl = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  const { active } = panel.selection.value;
  const range = panel.range.value;
  const take = () => event.preventDefault();
  if (ctrl && !event.altKey) {
    if (key === "z" && !event.shiftKey) return take(), panel.refused(session.value.undo());
    if (key === "y" || (key === "z" && event.shiftKey)) return take(), panel.refused(session.value.redo());
    if (key === "b" || key === "i") return take(), session.value.toggleStyle(range, active, key === "b" ? "bold" : "italic");
    if ((key === "d" || key === "r") && !event.shiftKey) {
      // Ctrl+D and Ctrl+R copy; only the fill handle continues a series.
      take();
      const plan = fillShortcut(range, key === "d" ? "down" : "right");
      if (plan) panel.refused(session.value.fill(plan, "copy"));
      return;
    }
    if (event.key === ";") return take(), session.value.insertToday(active.row, active.col);
  }
  if (event.key === " " && !ctrl && !event.altKey && session.value.toggleChecks(range, active)) return take();
  if (event.altKey && event.key === "ArrowDown") {
    if (showsFilter(active.row, active.col)) return take(), openFilter(active.col);
    if (kind(active.row, active.col) === "dropdown") return take(), void openDropdown(active.row, active.col);
  }
}

// ── Dropdown cells

async function openDropdown(row: number, col: number) {
  const format = session.value.formatOf(row, col);
  if (format.type !== "dropdown") return;
  const element = gridPart.value?.cellElement({ row, col });
  if (!element) return;
  const current = session.value.rawAt(row, col);
  const style = getComputedStyle(document.documentElement);
  const items: MenuEntry[] = [
    { type: "heading", label: t("dropdown.pick") },
    ...format.options.map((option, index): MenuEntry => ({
      type: "item",
      id: `o${index}`,
      label: option.value.slice(0, 80),
      checked: current === option.value,
      radio: true,
      ...(option.color ? { color: style.getPropertyValue(`--${option.color}`).trim() || "transparent" } : {}),
    })),
    { type: "separator" },
    { type: "item", id: "clear", label: t("dropdown.clear"), disabled: current === undefined },
  ];
  const choice = await panel.showMenu({ anchor: element, items });
  if (choice === "clear") session.value.setRaw(row, col, null);
  else if (choice?.startsWith("o")) session.value.setRaw(row, col, format.options[Number(choice.slice(1))]?.value ?? null);
  gridPart.value?.focus();
}

function toggleCheck(row: number, col: number, on: boolean) {
  if (isFormula(session.value.rawAt(row, col) ?? "")) return;
  session.value.setRaw(row, col, on ? "TRUE" : "FALSE", "check");
}

// ── Right-click

async function onMenu(target: { kind: "cell" | "row" | "column" | "corner"; row: number; col: number; element: HTMLElement }) {
  const range = panel.range.value;
  const rowsCount = range.bottom - range.top + 1;
  const colsCount = range.right - range.left + 1;
  const link = target.kind === "cell" && kind(target.row, target.col) === "link" ? session.value.rawAt(target.row, target.col) : undefined;
  const items: MenuEntry[] = [
    ...(link ? [{ type: "item", id: "link", label: t("linkOpen") } as MenuEntry, { type: "separator" } as MenuEntry] : []),
    { type: "item", id: "rowAbove", label: t("row.above") },
    { type: "item", id: "rowBelow", label: t("row.below") },
    { type: "item", id: "colLeft", label: t("col.left") },
    { type: "item", id: "colRight", label: t("col.right") },
    { type: "separator" },
    { type: "item", id: "deleteRows", label: plural("row.delete", rowsCount), danger: true },
    { type: "item", id: "deleteCols", label: plural("col.delete", colsCount), danger: true },
    { type: "separator" },
    { type: "item", id: "clear", label: t("clearCells"), hint: "Del" },
  ];
  const choice = await panel.showMenu({ anchor: target.element, items, side: target.kind === "column" ? "bottom" : "right" });
  const shift = (axis: "row" | "col", at: number, count: number) => panel.refused(session.value.shift(axis, at, count));
  if (choice === "rowAbove") shift("row", range.top, rowsCount);
  else if (choice === "rowBelow") shift("row", range.bottom + 1, rowsCount);
  else if (choice === "colLeft") shift("col", range.left, colsCount);
  else if (choice === "colRight") shift("col", range.right + 1, colsCount);
  else if (choice === "deleteRows") shift("row", range.top, -rowsCount);
  else if (choice === "deleteCols") shift("col", range.left, -colsCount);
  else if (choice === "clear") session.value.clear(range);
  else if (choice === "link" && link) emit("open-link", link);
  gridPart.value?.focus();
}

// ── The filter's ▾

const filterCol = ref<number | null>(null);
const filterAnchor = shallowRef<HTMLElement | null>(null);
function openFilter(col: number) {
  filterAnchor.value = gridPart.value?.cellElement({ row: 0, col }) ?? null;
  filterCol.value = filterAnchor.value ? col : null;
}
function closeFilter(open: boolean) {
  if (open) return;
  filterCol.value = null;
  nextTick(() => gridPart.value?.focus());
}

// ── Function names in the cell editor

const hints = ref<InstanceType<typeof FunctionHints> | null>(null);
const editorCaret = ref(0);
const editorField = shallowRef<HTMLTextAreaElement | null>(null);
watch(
  () => panel.editing.value?.text,
  () =>
    nextTick(() => {
      const editor = gridPart.value?.editorElement() ?? null;
      editorField.value = editor;
      editorCaret.value = editor?.selectionStart ?? panel.editing.value?.text.length ?? 0;
    }),
);
const editorActive = computed(() => !!panel.editing.value && !!editorField.value && document.activeElement === editorField.value);
function onEditorKey(event: KeyboardEvent) {
  hints.value?.handleKey(event);
}
function insertFunction(next: string, at: number) {
  const current = panel.editing.value;
  if (!current) return;
  panel.editing.value = { ...current, text: next };
  nextTick(() => {
    editorField.value?.focus();
    editorField.value?.setSelectionRange(at, at);
    editorCaret.value = at;
  });
}
</script>

<template>
  <div class="relative min-h-0 flex-1">
    <DataGrid
      ref="gridPart"
      v-model:selection="panel.selection.value"
      v-model:editing="panel.editing.value"
      v-model:scroll="scroll"
      class="absolute inset-0 rounded-none"
      :rows="rows"
      :cols="cols"
      :text="text"
      :edit-text="editText"
      :filled="filled"
      :cell-class="cellClass"
      :cell-title="cellTitle"
      :column-widths="sheet.colWidths"
      :row-heights="sheet.rowHeights"
      :hidden-rows="session.hidden.value"
      :frozen-rows="sheet.frozen.rows"
      :frozen-cols="sheet.frozen.cols"
      :used-bottom="session.used.value.rows - 1"
      :used-right="session.used.value.cols - 1"
      :aria-label="sheet.name"
      data-testid="grid"
      @commit="commit"
      @clear="clear"
      @fill="fill"
      @resize-column="resizeColumn"
      @resize-row="resizeRow"
      @copy="copy"
      @cut="cut"
      @paste="paste"
      @keydown="onKey"
      @editor-keydown="onEditorKey"
      @menu="onMenu"
    >
      <template #cell="{ row, col, text: shown }">
        <Checkbox
          v-if="kind(row, col) === 'checkbox' && session.rawAt(row, col) !== undefined"
          tabindex="-1"
          :model-value="session.valueAt(row, col) === true"
          :disabled="isFormula(session.rawAt(row, col) ?? '')"
          :aria-label="shown"
          @update:model-value="(on) => toggleCheck(row, col, on === true)"
        />
        <template v-else-if="kind(row, col) === 'dropdown'">
          <Badge v-if="shown" variant="secondary" :class="['min-w-0 truncate rounded-full border-transparent', pillColor(row, col, shown)]">{{ shown }}</Badge>
          <span class="flex-1" />
          <Button variant="ghost" size="icon-xs" tabindex="-1" class="size-5 flex-none text-muted-foreground" :aria-label="t('dropdown.pick')" :title="`${t('dropdown.pick')} (Alt+↓)`" @click="openDropdown(row, col)">
            <ChevronDown class="size-3.5" :stroke-width="1.5" />
          </Button>
        </template>
        <span
          v-else-if="kind(row, col) === 'link' && shown"
          class="min-w-0 cursor-pointer truncate text-primary underline underline-offset-2"
          :title="t('linkOpen')"
          @click="emit('open-link', session.rawAt(row, col) ?? shown)"
        >{{ shown }}</span>
        <span v-else :class="['min-w-0', session.styleOf(row, col).wrap ? 'break-words' : 'truncate']">{{ shown }}</span>
        <Button
          v-if="showsFilter(row, col)"
          variant="ghost"
          size="icon-xs"
          tabindex="-1"
          :aria-label="t('filter.open')"
          :title="`${t('filter.open')} (Alt+↓)`"
          :class="['ml-auto size-5 flex-none', filterOn(col) ? 'text-primary' : 'text-muted-foreground']"
          data-testid="filter-button"
          @click="openFilter(col)"
        >
          <ListFilter class="size-3.5" :stroke-width="1.5" />
        </Button>
      </template>
    </DataGrid>

    <FunctionHints ref="hints" :field="editorField" :text="panel.editing.value?.text ?? ''" :caret="editorCaret" :active="editorActive" @insert="insertFunction" />

    <Popover :open="filterCol !== null" @update:open="closeFilter">
      <PopoverAnchor :reference="filterAnchor ?? undefined" />
      <PopoverContent v-if="filterCol !== null" side="bottom" align="start" class="w-64">
        <FilterPanel :col="filterCol" />
      </PopoverContent>
    </Popover>
  </div>
</template>
