<script setup lang="ts">
// The sheets as tabs at the bottom (add, rename in place, drag to reorder, close to delete with Undo), and on the
// right the sum and count of what is selected.
import { Plus } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { TabStrip } from "@tavora/official-ui/components/ui/tabs";
import { toast, undoable } from "@tavora/official-ui/components/ui/toast";
import { computed, inject } from "vue";
import { PANEL } from "./context";
import { localNumber } from "./display";
import { t } from "./i18n";
import { LIMITS } from "./model";

const panel = inject(PANEL)!;
const session = computed(() => panel.session.value!);
const tabs = computed(() => {
  void session.value.version.value;
  const sheets = session.value.doc.value.sheets;
  return sheets.map((sheet) => ({ id: sheet.id, label: sheet.name, closable: sheets.length > 1, renamable: true }));
});
const current = computed({
  get: () => session.value.sheetId.value,
  set: (id: string) => {
    session.value.sheetId.value = id;
    panel.editing.value = null;
  },
});

function add() {
  panel.refused(session.value.addNewSheet(`s-${crypto.randomUUID().slice(0, 8)}`, t("sheet.base")));
}

function rename(id: string, name: string) {
  if (!session.value.renameSheet(id, name.slice(0, LIMITS.name))) toast({ title: t("sheet.nameTaken"), variant: "error", duration: 4000 });
}

/** Deleted at once; Undo on the toast (or Ctrl+Z in the sheet) brings the sheet and its formulas back. */
function close(id: string) {
  const name = session.value.doc.value.sheets.find((sheet) => sheet.id === id)?.name ?? "";
  const target = session.value;
  const changes = target.removeSheet(id);
  if (!changes) return;
  undoable({ title: t("sheet.deleted", { name }), key: false, undo: () => target.revert(changes) });
}

const summary = computed(() => {
  void session.value.version.value;
  return session.value.summary(panel.range.value);
});
const many = computed(() => summary.value.count > 1);
const format = (value: number) => localNumber(Number(value.toPrecision(12)), panel.lang.value);
</script>

<template>
  <footer class="flex h-9 flex-none items-center gap-2 border-t border-border bg-card px-1" data-testid="sheet-tabs">
    <TabStrip
      v-model="current"
      class="min-w-0 flex-1"
      :tabs="tabs"
      :max-length="LIMITS.name"
      :aria-label="t('sheets')"
      @rename="rename"
      @reorder="(ids) => session.reorderSheets(ids)"
      @close="close"
    >
      <template #add>
        <Button variant="ghost" size="icon-xs" :aria-label="t('sheet.add')" :title="t('sheet.add')" data-testid="add-sheet" @click="add"><Plus :stroke-width="1.5" /></Button>
      </template>
    </TabStrip>
    <p v-if="many" class="flex flex-none items-center gap-3 pr-2 text-xs text-muted-foreground tabular-nums" role="status" data-testid="summary">
      <span v-if="summary.numbers">{{ t("summary.sum", { value: format(summary.sum) }) }}</span>
      <span>{{ t("summary.count", { value: summary.count }) }}</span>
    </p>
  </footer>
</template>
