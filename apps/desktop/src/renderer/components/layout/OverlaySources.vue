<script setup lang="ts">
// The Overlay page's Sources panel: every panel from every workspace, with the workspace it is in ("Notes · Satisfactory"),
// and the module overlays the setup shown already holds. A panel that is in the setup is picked here (and on the canvas),
// and its eye hides it on the canvas only; one that is not is added with a click; one that can't go into this setup is
// greyed out with the reason and kept together, folded, at the bottom. The search narrows the list by name and workspace.
import { Check, Eye, EyeOff, Plus } from "@lucide/vue";
import { computed, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@tavora/official-ui/components/ui/collapsible";
import { Input } from "@tavora/official-ui/components/ui/input";
import { cn } from "@/lib/utils";
import type { SourceBlock } from "../../../shared/layout-view";
import { t } from "../../i18n";
import ModuleIcon from "../ModuleIcon.vue";
import { send, view } from "./layout-state";

interface Row {
  key: string;
  name: string;
  from: string;
  moduleId: string;
  /** The item of the setup this row is, else null. */
  item: string | null;
  hidden: boolean;
  block: SourceBlock | null;
  game: string | null;
}

const query = ref("");

const rows = computed<Row[]>(() => {
  const current = view.value;
  if (!current) return [];
  const inSetup = new Map(current.items.map((item) => [item.target.kind === "panel" ? item.target.instanceId : item.id, item]));
  const rows: Row[] = [];
  // What the setup holds first (module overlays have no other place in the list), then what can be added, then what can't.
  for (const item of current.items) {
    if (item.kind === "overlay") rows.push({ key: item.id, name: item.name, from: item.from, moduleId: item.moduleId, item: item.id, hidden: item.hiddenOnCanvas, block: "in-setup", game: null });
  }
  for (const source of current.sources) {
    const item = inSetup.get(source.id);
    rows.push({ key: source.id, name: source.name, from: source.from, moduleId: source.moduleId, item: item?.id ?? null, hidden: item?.hiddenOnCanvas ?? false, block: source.block, game: source.game });
  }
  const rank = (row: Row) => (row.item ? 0 : row.block === null ? 1 : 2);
  return rows.map((row, index) => ({ row, index })).sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index).map(({ row }) => row);
});

const shown = computed(() => {
  const text = query.value.trim().toLowerCase();
  return text ? rows.value.filter((row) => `${row.name} ${row.from}`.toLowerCase().includes(text)) : rows.value;
});

// What can be picked or added shows in the list; what can't is folded away below it.
const usable = computed(() => shown.value.filter((row) => row.item !== null || row.block === null));
const unusable = computed(() => shown.value.filter((row) => row.item === null && row.block !== null));
const folded = ref(false);

const count = computed(() => view.value?.items.length ?? 0);

function reason(row: Row): string | null {
  if (row.block === null || row.block === "in-setup") return null;
  return t(`overlays.layout.block.${row.block}`, { game: row.game ?? "" });
}

function press(row: Row) {
  if (row.item) send({ type: "select", id: view.value?.selection === row.item ? null : row.item });
  else if (row.block === null) send({ type: "add-source", id: row.key });
}
</script>

<template>
  <section class="bg-card flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-lg border py-3 pr-3 pl-3" :aria-label="t('overlays.layout.sources')" data-testid="layout-sources">
    <div class="flex items-baseline justify-between px-1">
      <h2 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{{ t("overlays.layout.sources") }}</h2>
      <span class="text-muted-foreground text-xs" data-testid="layout-count">{{ t("overlays.layout.count", { count, max: view?.limit ?? 0 }) }}</span>
    </div>
    <Input v-model="query" type="search" :placeholder="t('overlays.layout.search')" :aria-label="t('overlays.layout.search')" data-testid="layout-search" />
    <p v-if="!shown.length" class="text-muted-foreground px-1 py-2 text-sm" data-testid="layout-empty">{{ query ? t("overlays.layout.noSources") : t("overlays.layout.nothing") }}</p>
    <div v-else class="-mr-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]" data-testid="layout-sources-list">
      <ul class="flex flex-col gap-1">
        <li
          v-for="row in usable"
          :key="row.key"
          :class="cn('flex items-center gap-1 rounded-md border', view?.selection === row.item && row.item ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-accent', row.item === null && row.block !== null && 'opacity-50 hover:bg-transparent')"
          :data-testid="`layout-source-${row.key}`"
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 disabled:cursor-not-allowed"
            :disabled="row.item === null && row.block !== null"
            :aria-pressed="row.item ? view?.selection === row.item : undefined"
            :aria-label="row.item === null && row.block === null ? t('overlays.layout.addNamed', { name: row.name }) : undefined"
            @click="press(row)"
          >
            <ModuleIcon :module-id="row.moduleId" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{{ row.name }}</span>
              <span class="text-muted-foreground block truncate text-xs">{{ row.from }}<template v-if="reason(row)"> · {{ reason(row) }}</template></span>
            </span>
            <Plus v-if="row.item === null && row.block === null" class="text-muted-foreground size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
            <Check v-else-if="row.item" class="text-success size-4 flex-none" :stroke-width="1.5" :aria-label="t('overlays.layout.inSetup')" />
          </button>
          <Button
            v-if="row.item"
            variant="ghost"
            size="icon-sm"
            :aria-label="row.hidden ? t('overlays.layout.showOnCanvas') : t('overlays.layout.hideOnCanvas')"
            :title="row.hidden ? t('overlays.layout.showOnCanvas') : t('overlays.layout.hideOnCanvas')"
            :data-testid="`layout-eye-${row.item}`"
            @click="send({ type: 'canvas-hidden', id: row.item, hidden: !row.hidden })"
          >
            <EyeOff v-if="row.hidden" :stroke-width="1.5" />
            <Eye v-else :stroke-width="1.5" />
          </Button>
        </li>
      </ul>
      <Collapsible v-if="unusable.length" v-model:open="folded" class="mt-1" data-testid="layout-unusable">
        <CollapsibleTrigger class="text-muted-foreground flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-xs outline-none focus-visible:ring-2" data-testid="layout-unusable-toggle">
          {{ t("overlays.layout.unusable", { count: unusable.length }) }}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul class="flex flex-col gap-1">
          <li
            v-for="row in unusable"
            :key="row.key"
            :class="cn('flex items-center gap-1 rounded-md border', view?.selection === row.item && row.item ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-accent', row.item === null && row.block !== null && 'opacity-50 hover:bg-transparent')"
            :data-testid="`layout-source-${row.key}`"
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 disabled:cursor-not-allowed"
              :disabled="row.item === null && row.block !== null"
              :aria-pressed="row.item ? view?.selection === row.item : undefined"
              :aria-label="row.item === null && row.block === null ? t('overlays.layout.addNamed', { name: row.name }) : undefined"
              @click="press(row)"
            >
              <ModuleIcon :module-id="row.moduleId" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">{{ row.name }}</span>
                <span class="text-muted-foreground block truncate text-xs">{{ row.from }}<template v-if="reason(row)"> · {{ reason(row) }}</template></span>
              </span>
              <Plus v-if="row.item === null && row.block === null" class="text-muted-foreground size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
              <Check v-else-if="row.item" class="text-success size-4 flex-none" :stroke-width="1.5" :aria-label="t('overlays.layout.inSetup')" />
            </button>
            <Button
              v-if="row.item"
              variant="ghost"
              size="icon-sm"
              :aria-label="row.hidden ? t('overlays.layout.showOnCanvas') : t('overlays.layout.hideOnCanvas')"
              :title="row.hidden ? t('overlays.layout.showOnCanvas') : t('overlays.layout.hideOnCanvas')"
              :data-testid="`layout-eye-${row.item}`"
              @click="send({ type: 'canvas-hidden', id: row.item, hidden: !row.hidden })"
            >
              <EyeOff v-if="row.hidden" :stroke-width="1.5" />
              <Eye v-else :stroke-width="1.5" />
            </Button>
          </li>
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  </section>
</template>
