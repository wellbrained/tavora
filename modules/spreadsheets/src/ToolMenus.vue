<script setup lang="ts">
// The items of the toolbar's menus, drawn into a menu of their own (wide panel) or a submenu of ··· (narrow one).
import { ArrowDownAZ, ArrowDownZA, Columns3, FileDown, FileInput, FileSpreadsheet, FileUp, ListFilter, Rows3, Save, Snowflake, Trash2, WrapText } from "@lucide/vue";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@tavora/official-ui/components/ui/dropdown-menu";
import { computed, inject } from "vue";
import { columnName } from "./formula/refs";
import { plural, t } from "./i18n";
import { COLORS, type Align, type CellFormat, type ColorName } from "./model";
import { PANEL } from "./context";
import { isActive } from "./table";

const props = defineProps<{ part: "align" | "format" | "sort" | "rows" | "freeze" | "files" | "colors" }>();
const panel = inject(PANEL)!;
const session = computed(() => panel.session.value!);
const active = computed(() => panel.selection.value.active);
const range = computed(() => panel.range.value);

// ── Align

const align = computed<Align>(() => session.value.styleOf(active.value.row, active.value.col).align ?? "left");
const wrapped = computed(() => !!session.value.styleOf(active.value.row, active.value.col).wrap);
const setAlign = (value: unknown) => session.value.styleRange(range.value, { align: value as Align });

// ── Format

const format = computed(() => session.value.formatOf(active.value.row, active.value.col));
const setFormat = (next: CellFormat) => session.value.formatRange(range.value, next);
const simple = ["auto", "text", "checkbox", "date", "link"] as const;
const typeLabel = (type: CellFormat["type"]) => t(`format.${type}`);
const decimalsOf = computed(() => (format.value.type === "number" || format.value.type === "percent" ? format.value.decimals : -1));
const thousands = computed(() => format.value.type === "number" && format.value.thousands);

// ── Colours (narrow panel; the wide one has swatches)

const look = computed(() => session.value.styleOf(active.value.row, active.value.col));
const setColor = (kind: "color" | "fill", value: ColorName | "none") => session.value.styleRange(range.value, { [kind]: value === "none" ? undefined : value });

// ── Sort and filter

const sortBy = (descending: boolean) => session.value.sort(range.value, [{ col: active.value.col, descending }]);
const filterOn = computed(() => !!session.value.sheet.value.filter);
const filterActive = computed(() => Object.values(session.value.sheet.value.filter?.columns ?? {}).some(isActive));

// ── Rows and columns

const rowCount = computed(() => range.value.bottom - range.value.top + 1);
const colCount = computed(() => range.value.right - range.value.left + 1);
const shift = (axis: "row" | "col", at: number, count: number) => panel.refused(session.value.shift(axis, at, count));

// ── Freeze

const frozen = computed(() => session.value.sheet.value.frozen);
const freezeRows = (rows: number) => session.value.freeze(rows, frozen.value.cols);
const freezeCols = (cols: number) => session.value.freeze(frozen.value.rows, cols);
</script>

<template>
  <template v-if="props.part === 'align'">
    <DropdownMenuRadioGroup :model-value="align" @update:model-value="setAlign">
      <DropdownMenuRadioItem value="left">{{ t("align.left") }}</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="center">{{ t("align.center") }}</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="right">{{ t("align.right") }}</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
    <DropdownMenuSeparator />
    <DropdownMenuCheckboxItem :model-value="wrapped" @update:model-value="session.toggleStyle(range, active, 'wrap')"><WrapText :stroke-width="1.5" /> {{ t("wrap") }}</DropdownMenuCheckboxItem>
  </template>

  <template v-else-if="props.part === 'format'">
    <DropdownMenuRadioGroup :model-value="format.type">
      <DropdownMenuRadioItem v-for="type in simple.slice(0, 1)" :key="type" :value="type" @select="setFormat({ type })">{{ typeLabel(type) }}</DropdownMenuRadioItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger :class="format.type === 'number' && 'font-medium'">{{ t("format.number") }}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup :model-value="format.type === 'number' ? String(decimalsOf) : ''">
            <DropdownMenuRadioItem v-for="decimals in [0, 1, 2, 3]" :key="decimals" :value="String(decimals)" @select="setFormat({ type: 'number', decimals, thousands })">{{ plural("format.decimals", decimals) }}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem :model-value="thousands" @update:model-value="(on) => setFormat({ type: 'number', decimals: Math.max(0, decimalsOf), thousands: !!on })">{{ t("format.thousands") }}</DropdownMenuCheckboxItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger :class="format.type === 'percent' && 'font-medium'">{{ t("format.percent") }}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup :model-value="format.type === 'percent' ? String(decimalsOf) : ''">
            <DropdownMenuRadioItem v-for="decimals in [0, 1, 2]" :key="decimals" :value="String(decimals)" @select="setFormat({ type: 'percent', decimals })">{{ plural("format.decimals", decimals) }}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuRadioItem v-for="type in simple.slice(1)" :key="type" :value="type" @select="setFormat({ type })">{{ typeLabel(type) }}</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="dropdown" @select="panel.openDialog('dropdown')">{{ t("format.dropdownEdit") }}</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  </template>

  <template v-else-if="props.part === 'colors'">
    <DropdownMenuSub v-for="kind in ['color', 'fill'] as const" :key="kind">
      <DropdownMenuSubTrigger>{{ t(kind === "color" ? "colors.text" : "colors.fill") }}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup :model-value="look[kind] ?? 'none'" @update:model-value="(value) => setColor(kind, value as ColorName | 'none')">
          <DropdownMenuRadioItem value="none">{{ t("colors.none") }}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem v-for="color in COLORS" :key="color" :value="color">
            <span aria-hidden="true" class="size-3 rounded-full" :style="{ background: `var(--${color})` }" />
            {{ t(`color.${color}`) }}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  </template>

  <template v-else-if="props.part === 'sort'">
    <DropdownMenuItem @select="sortBy(false)"><ArrowDownAZ :stroke-width="1.5" /> {{ t("sort.az") }}</DropdownMenuItem>
    <DropdownMenuItem @select="sortBy(true)"><ArrowDownZA :stroke-width="1.5" /> {{ t("sort.za") }}</DropdownMenuItem>
    <DropdownMenuItem @select="panel.openDialog('sort')">{{ t("sort.more") }}</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuCheckboxItem :model-value="session.sheet.value.header" @update:model-value="(on) => session.setHeader(!!on)">{{ t("header") }}</DropdownMenuCheckboxItem>
    <DropdownMenuCheckboxItem :model-value="filterOn" @update:model-value="session.toggleFilter()"><ListFilter :stroke-width="1.5" /> {{ t("filter.on") }}</DropdownMenuCheckboxItem>
    <DropdownMenuItem :disabled="!filterActive" @select="session.clearFilter()">{{ t("filter.clear") }}</DropdownMenuItem>
  </template>

  <template v-else-if="props.part === 'rows'">
    <DropdownMenuItem @select="shift('row', range.top, rowCount)"><Rows3 :stroke-width="1.5" /> {{ t("row.above") }}</DropdownMenuItem>
    <DropdownMenuItem @select="shift('row', range.bottom + 1, rowCount)"><Rows3 :stroke-width="1.5" /> {{ t("row.below") }}</DropdownMenuItem>
    <DropdownMenuItem @select="shift('col', range.left, colCount)"><Columns3 :stroke-width="1.5" /> {{ t("col.left") }}</DropdownMenuItem>
    <DropdownMenuItem @select="shift('col', range.right + 1, colCount)"><Columns3 :stroke-width="1.5" /> {{ t("col.right") }}</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive" @select="shift('row', range.top, -rowCount)"><Trash2 :stroke-width="1.5" /> {{ plural("row.delete", rowCount) }}</DropdownMenuItem>
    <DropdownMenuItem variant="destructive" @select="shift('col', range.left, -colCount)"><Trash2 :stroke-width="1.5" /> {{ plural("col.delete", colCount) }}</DropdownMenuItem>
  </template>

  <template v-else-if="props.part === 'freeze'">
    <DropdownMenuItem @select="session.freeze(0, 0)"><Snowflake :stroke-width="1.5" /> {{ t("freeze.off") }}</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuCheckboxItem :model-value="frozen.rows === 1" @update:model-value="(on) => freezeRows(on ? 1 : 0)">{{ t("freeze.row") }}</DropdownMenuCheckboxItem>
    <DropdownMenuCheckboxItem v-if="active.row > 0" :model-value="frozen.rows === active.row + 1" @update:model-value="(on) => freezeRows(on ? active.row + 1 : 0)">{{ t("freeze.rowsHere", { row: active.row + 1 }) }}</DropdownMenuCheckboxItem>
    <DropdownMenuCheckboxItem :model-value="frozen.cols === 1" @update:model-value="(on) => freezeCols(on ? 1 : 0)">{{ t("freeze.col") }}</DropdownMenuCheckboxItem>
    <DropdownMenuCheckboxItem v-if="active.col > 0" :model-value="frozen.cols === active.col + 1" @update:model-value="(on) => freezeCols(on ? active.col + 1 : 0)">{{ t("freeze.colsHere", { col: columnName(active.col) }) }}</DropdownMenuCheckboxItem>
  </template>

  <template v-else-if="props.part === 'files'">
    <DropdownMenuItem @select="panel.runFileAction('file.open')"><FileInput :stroke-width="1.5" /> {{ t("file.open") }}</DropdownMenuItem>
    <DropdownMenuItem @select="panel.runFileAction('file.save')"><Save :stroke-width="1.5" /> {{ t("file.save") }}</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem @select="panel.runFileAction('csv.import')"><FileDown :stroke-width="1.5" /> {{ t("csv.import") }}</DropdownMenuItem>
    <DropdownMenuItem @select="panel.runFileAction('csv.export')"><FileUp :stroke-width="1.5" /> {{ t("csv.export") }}</DropdownMenuItem>
    <DropdownMenuItem @select="panel.runFileAction('xlsx.import')"><FileSpreadsheet :stroke-width="1.5" /> {{ t("xlsx.import") }}</DropdownMenuItem>
    <DropdownMenuItem @select="panel.runFileAction('xlsx.export')"><FileUp :stroke-width="1.5" /> {{ t("xlsx.export") }}</DropdownMenuItem>
  </template>
</template>
