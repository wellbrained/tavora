<script setup lang="ts">
// The formula bar: the selected cell's name (type another one and press Enter to go there) and what the cell holds,
// its formula in the language shown. Typing here edits the cell, shown in the cell too; Enter keeps it, Esc drops it.
import { Input } from "@tavora/official-ui/components/ui/input";
import { cell } from "@tavora/official-ui/components/ui/data-grid";
import { computed, inject, nextTick, ref, watch } from "vue";
import { PANEL } from "./context";
import { parseRangeName, rangeName } from "./formula/refs";
import FunctionHints from "./FunctionHints.vue";
import { t } from "./i18n";
import { LIMITS } from "./model";

const panel = inject(PANEL)!;
const session = computed(() => panel.session.value!);
const active = computed(() => panel.selection.value.active);
const name = computed(() => rangeName(panel.range.value));

// ── The cell name

const nameText = ref(name.value);
const nameFocused = ref(false);
watch(name, (next) => {
  if (!nameFocused.value) nameText.value = next;
});

function goTo() {
  const range = parseRangeName(nameText.value.trim().toUpperCase());
  if (!range || range.bottom >= LIMITS.rows || range.right >= LIMITS.cols) {
    nameText.value = name.value;
    return;
  }
  panel.selection.value = { active: cell(range.top, range.left), anchor: cell(range.top, range.left), focus: cell(range.bottom, range.right) };
  nextTick(() => {
    panel.grid.value?.scrollToCell(cell(range.top, range.left));
    panel.grid.value?.focus();
  });
}

function onNameKey(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    goTo();
  } else if (event.key === "Escape") {
    event.preventDefault();
    nameText.value = name.value;
    panel.grid.value?.focus();
  }
}

// ── What the cell holds

const fieldPart = ref<{ $el: HTMLInputElement } | null>(null);
const field = computed(() => fieldPart.value?.$el ?? null);
const focused = ref(false);
const caret = ref(0);
const hints = ref<InstanceType<typeof FunctionHints> | null>(null);
const editingHere = computed(() => panel.editing.value && panel.editing.value.row === active.value.row && panel.editing.value.col === active.value.col);
const text = computed(() => {
  void session.value.version.value;
  return editingHere.value ? panel.editing.value!.text : session.value.editTextAt(active.value.row, active.value.col);
});

const onFocus = () => {
  focused.value = true;
  if (!editingHere.value) panel.editing.value = { row: active.value.row, col: active.value.col, text: text.value, mode: "edit" };
};

function onInput(event: Event) {
  const input = event.target as HTMLInputElement;
  caret.value = input.selectionStart ?? input.value.length;
  panel.editing.value = { row: active.value.row, col: active.value.col, text: input.value, mode: "edit" };
}

function onKey(event: KeyboardEvent) {
  if (hints.value?.handleKey(event)) return;
  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    panel.grid.value?.commitEdit({ key: event.key, shift: event.shiftKey });
  } else if (event.key === "Escape") {
    event.preventDefault();
    panel.grid.value?.cancelEdit();
  }
}

function onBlur(event: FocusEvent) {
  focused.value = false;
  const next = event.relatedTarget;
  // Into the cell's own editor or the list of functions, the edit goes on.
  if (next instanceof HTMLElement && (next.closest("[data-grid-keep-edit]") || next.matches("[data-grid-editor]"))) return;
  if (panel.editing.value) panel.grid.value?.commitEdit();
}

function insert(next: string, at: number) {
  panel.editing.value = { row: active.value.row, col: active.value.col, text: next, mode: "edit" };
  nextTick(() => {
    field.value?.focus();
    field.value?.setSelectionRange(at, at);
    caret.value = at;
  });
}

const trackCaret = (event: Event) => (caret.value = (event.target as HTMLInputElement).selectionStart ?? 0);
</script>

<template>
  <div class="flex h-9 flex-none items-center gap-2 border-b border-border bg-card px-2" data-grid-keep-edit>
    <Input
      v-model="nameText"
      :aria-label="t('bar.cell')"
      class="h-7 w-24 flex-none px-2 font-mono text-sm"
      spellcheck="false"
      data-testid="cell-name"
      @focus="(nameFocused = true, ($event.target as HTMLInputElement).select())"
      @blur="(nameFocused = false, (nameText = name))"
      @keydown="onNameKey"
    />
    <span aria-hidden="true" class="font-mono text-sm text-muted-foreground italic">{{ t("bar.fx") }}</span>
    <Input
      ref="fieldPart"
      :model-value="text"
      :aria-label="t('bar.formula', { cell: name })"
      spellcheck="false"
      data-testid="formula"
      class="h-7 min-w-0 flex-1 px-2 font-mono text-sm"
      @focus="onFocus"
      @input="onInput"
      @keydown="onKey"
      @keyup="trackCaret"
      @click="trackCaret"
      @blur="onBlur"
    />
    <FunctionHints ref="hints" :field="field" :text="text" :caret="caret" :active="focused" @insert="insert" />
  </div>
</template>
