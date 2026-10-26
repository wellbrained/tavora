<script setup lang="ts">
// The apps running on this PC with their memory and CPU, opened from the Memory card. Tavora reads the list only
// while this dialog is open and the panel is shown: every 2 seconds, the next read only after the last one came back.
import { ArrowDown, ArrowUp } from "@lucide/vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { Input } from "@tavora/official-ui/components/ui/input";
import type { SystemApps, TavoraSDK } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { firstDirection, listApps, shownBytes, type AppsSort } from "./apps";
import { memory, num, size } from "./format";
import { language, t } from "./i18n";

const props = defineProps<{ sdk: TavoraSDK }>();
const emit = defineEmits<{ close: [] }>();

const REFRESH_MS = 2000;

const read = shallowRef<SystemApps | null>(null);
const failed = ref(false);
const query = ref("");
const sortBy = ref<AppsSort>("memory");
const direction = ref<"up" | "down">("down");

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

function sort(by: AppsSort): void {
  if (sortBy.value === by) direction.value = direction.value === "up" ? "down" : "up";
  else {
    sortBy.value = by;
    direction.value = firstDirection(by);
  }
}

const rows = computed(() => (read.value ? listApps(read.value.apps, query.value, sortBy.value, direction.value, language.value) : []));
const total = computed(() =>
  read.value && read.value.usedBytes > 0 ? t("apps.total", { shown: size(shownBytes(rows.value), language.value), used: size(read.value.usedBytes, language.value) }) : "",
);
const cpuText = (cpu: number | null) => (cpu === null ? "–" : `${num(cpu, 1, language.value)} %`);

const COLUMNS: { id: AppsSort; label: "apps.app" | "apps.ram" | "apps.cpu"; class: string }[] = [
  { id: "name", label: "apps.app", class: "min-w-0 flex-1 justify-start" },
  { id: "memory", label: "apps.ram", class: "w-20 flex-none justify-end" },
  { id: "cpu", label: "apps.cpu", class: "w-16 flex-none justify-end" },
];
</script>

<template>
  <Dialog :open="true" @update:open="(value: boolean) => !value && emit('close')">
    <DialogContent class="top-[6vh] flex max-h-[88vh] translate-y-0 flex-col gap-3 sm:max-w-[440px]" data-testid="apps-dialog">
      <DialogHeader>
        <DialogTitle class="text-lg">{{ t("apps.title") }}</DialogTitle>
        <DialogDescription class="sr-only">{{ t("apps.title") }}</DialogDescription>
      </DialogHeader>
      <Input v-model="query" type="search" :placeholder="t('apps.search')" :aria-label="t('apps.search')" data-testid="apps-search" />

      <p v-if="failed && !read" class="text-muted-foreground py-6 text-center text-sm" role="alert" data-testid="apps-error">{{ t("apps.error") }}</p>
      <p v-else-if="!read" class="text-muted-foreground py-6 text-center text-sm" role="status" data-testid="apps-loading">{{ t("apps.loading") }}</p>
      <template v-else>
        <div class="flex items-center gap-1 border-b pb-1 pr-2">
          <Button
            v-for="column in COLUMNS"
            :key="column.id"
            type="button"
            variant="ghost"
            size="xs"
            :class="['text-muted-foreground', column.class]"
            :data-testid="`apps-sort-${column.id}`"
            @click="sort(column.id)"
          >
            {{ t(column.label) }}
            <template v-if="sortBy === column.id">
              <ArrowUp v-if="direction === 'up'" :stroke-width="1.75" />
              <ArrowDown v-else :stroke-width="1.75" />
            </template>
          </Button>
        </div>
        <ul class="-mt-2 min-h-0 flex-1 overflow-y-auto pr-2 text-sm tabular-nums" data-testid="apps-list">
          <li v-for="app in rows" :key="app.name" class="flex h-7 items-center gap-1" data-testid="app-row">
            <span class="flex min-w-0 flex-1 items-center gap-2 px-1.5">
              <span class="truncate">{{ app.name }}</span>
              <Badge v-if="app.windows" variant="secondary" data-testid="app-windows">{{ t("apps.windows") }}</Badge>
            </span>
            <span class="w-20 flex-none px-1.5 text-right">{{ memory(app.memoryBytes, language) }}</span>
            <span class="text-muted-foreground w-16 flex-none px-1.5 text-right">{{ cpuText(app.cpu) }}</span>
          </li>
          <li v-if="rows.length === 0" class="text-muted-foreground py-6 text-center" data-testid="apps-none">{{ t("apps.none") }}</li>
        </ul>
        <p class="text-muted-foreground text-xs tabular-nums" data-testid="apps-total">{{ total }}</p>
      </template>
    </DialogContent>
  </Dialog>
</template>
