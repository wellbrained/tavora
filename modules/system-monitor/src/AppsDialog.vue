<script setup lang="ts">
// The apps running on this PC with their memory and CPU, opened from the Memory card. Tavora reads the list only
// while this dialog is open and the panel is shown: every 2 seconds, the next read only after the last one came back.
// Apps under 5 % of the installed RAM fold away below the rest until the user opens them; a search finds them too.
import { ChevronRight, MemoryStick } from "@lucide/vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@tavora/official-ui/components/ui/dialog";
import { SearchInput } from "@tavora/official-ui/components/ui/search-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type TableSort } from "@tavora/official-ui/components/ui/table";
import type { SystemApps, TavoraSDK } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { firstDirection, listApps, ramShare, ramSplit, shownBytes, splitApps, type AppsSort } from "./apps";
import { memory, num } from "./format";
import { language, t } from "./i18n";

const props = defineProps<{ sdk: TavoraSDK; /** The installed RAM, for % RAM and which apps fold away. */ totalBytes: number }>();
const emit = defineEmits<{ close: [] }>();

const REFRESH_MS = 2000;

const read = shallowRef<SystemApps | null>(null);
const failed = ref(false);
const query = ref("");
const sort = ref<TableSort | null>({ column: "memory", direction: "descending" });
/** Whether the small apps are open; stays through refreshes, closed again the next time the dialog opens. */
const showSmall = ref(false);

let timer: ReturnType<typeof setTimeout> | undefined;
let open = true;
let suspended = false;

async function refresh(): Promise<void> {
  timer = undefined;
  try {
    read.value = await props.sdk.connectors.systemInfo.apps();
    failed.value = false;
  } catch {
    failed.value = true;
  }
  if (open && !suspended) timer = setTimeout(() => void refresh(), REFRESH_MS);
}

const cleanup: (() => void)[] = [];

onMounted(() => {
  void refresh();
  cleanup.push(
    props.sdk.lifecycle.onSuspend(() => {
      suspended = true;
      clearTimeout(timer);
      timer = undefined;
    }),
    props.sdk.lifecycle.onResume(() => {
      suspended = false;
      if (open && timer === undefined) void refresh();
    }),
  );
});

onBeforeUnmount(() => {
  open = false;
  clearTimeout(timer);
  cleanup.splice(0).forEach((fn) => fn());
});

const rows = computed(() =>
  read.value ? listApps(read.value.apps, query.value, (sort.value?.column ?? "memory") as AppsSort, sort.value?.direction === "ascending" ? "up" : "down", language.value) : [],
);
const sortFirst = (column: AppsSort) => (firstDirection(column) === "up" ? "ascending" : "descending");
const groups = computed(() => splitApps(rows.value, props.totalBytes, query.value));
/** The rows the user sees: the small ones only while open. */
const visible = computed(() => (showSmall.value ? rows.value : groups.value.big));
/** Every app, folded or found or not, plus the rest of the RAM in use, so the line adds up. */
const total = computed(() => {
  if (!read.value || read.value.usedBytes <= 0) return "";
  const split = ramSplit(shownBytes(read.value.apps), read.value.usedBytes);
  const gb = (value: number) => `${num(value, split.decimals, language.value)} GB`;
  return t("apps.total", { apps: gb(split.apps), rest: gb(split.rest), used: gb(split.used) });
});
/** CPU and % RAM alike: one decimal and a %, a dash while unknown. */
const pct = (value: number | null) => (value === null ? "–" : `${num(value, 1, language.value)} %`);

const COLUMNS: { id: AppsSort; label: "apps.app" | "apps.ram" | "apps.share" | "apps.cpu"; class: string; align?: "end" }[] = [
  { id: "name", label: "apps.app", class: "" },
  { id: "memory", label: "apps.ram", class: "w-24", align: "end" },
  { id: "share", label: "apps.share", class: "w-20", align: "end" },
  { id: "cpu", label: "apps.cpu", class: "w-20", align: "end" },
];
</script>

<template>
  <Dialog :open="true" @update:open="(value: boolean) => !value && emit('close')">
    <DialogContent size="lg" anchor="top" class="flex flex-col gap-4" data-testid="apps-dialog">
      <DialogHeader :icon="MemoryStick" :title="t('apps.title')" :description="t('apps.about')" />
      <SearchInput v-model="query" :placeholder="t('apps.search')" :aria-label="t('apps.search')" data-testid="apps-search" />

      <p v-if="failed && !read" class="text-muted-foreground py-6 text-center text-sm" role="alert" data-testid="apps-error">{{ t("apps.error") }}</p>
      <p v-else-if="!read" class="text-muted-foreground py-6 text-center text-sm" role="status" data-testid="apps-loading">{{ t("apps.loading") }}</p>
      <template v-else>
        <div class="flex min-h-0 flex-1 flex-col" data-testid="apps-list">
          <Table v-model:sort="sort" density="compact" layout="fixed" sticky-header flush container-class="min-h-0 flex-1 overflow-y-auto">
            <TableHeader>
              <TableRow>
                <TableHead v-for="column in COLUMNS" :key="column.id" :class="column.class" :align="column.align" :sort-key="column.id" :sort-first="sortFirst(column.id)" :data-testid="`apps-sort-${column.id}`">
                  {{ t(column.label) }}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
            <TableRow v-for="app in groups.big" :key="app.name" data-testid="app-row">
              <TableCell>
                <span class="flex min-w-0 items-center gap-2">
                  <span class="truncate">{{ app.name }}</span>
                  <Badge v-if="app.windows" variant="secondary" data-testid="app-windows">{{ t("apps.windows") }}</Badge>
                </span>
              </TableCell>
              <TableCell align="end" numeric>{{ memory(app.memoryBytes, language) }}</TableCell>
              <TableCell align="end" numeric class="text-muted-foreground">{{ pct(ramShare(app.memoryBytes, totalBytes)) }}</TableCell>
              <TableCell align="end" numeric class="text-muted-foreground">{{ pct(app.cpu) }}</TableCell>
            </TableRow>
            <TableRow v-if="groups.small.length">
              <TableCell :colspan="COLUMNS.length">
                <Button variant="ghost" size="xs" class="text-muted-foreground" :aria-expanded="showSmall" data-testid="apps-small" @click="showSmall = !showSmall">
                  <ChevronRight :class="['transition-transform', showSmall && 'rotate-90']" />
                  {{ showSmall ? t("apps.hideSmall") : t("apps.showSmall", { count: groups.small.length }) }}
                </Button>
              </TableCell>
            </TableRow>
            <TableRow v-for="app in showSmall ? groups.small : []" :key="app.name" data-testid="app-row">
              <TableCell>
                <span class="flex min-w-0 items-center gap-2">
                  <span class="truncate">{{ app.name }}</span>
                  <Badge v-if="app.windows" variant="secondary" data-testid="app-windows">{{ t("apps.windows") }}</Badge>
                </span>
              </TableCell>
              <TableCell align="end" numeric>{{ memory(app.memoryBytes, language) }}</TableCell>
              <TableCell align="end" numeric class="text-muted-foreground">{{ pct(ramShare(app.memoryBytes, totalBytes)) }}</TableCell>
              <TableCell align="end" numeric class="text-muted-foreground">{{ pct(app.cpu) }}</TableCell>
            </TableRow>
            </TableBody>
          </Table>
          <p v-if="rows.length === 0" class="text-muted-foreground py-6 text-center text-sm" data-testid="apps-none">{{ t("apps.none") }}</p>
        </div>
        <p class="text-muted-foreground text-xs tabular-nums" data-testid="apps-total">{{ total }}</p>
      </template>
    </DialogContent>
  </Dialog>
</template>
