<script setup lang="ts">
// The Overlay page's Sources panel: every panel from every workspace that can go into the setup shown, with the workspace it
// is in ("Notes · Satisfactory"). A panel that lists what it can show on its own (overlay.setSources: Clock & Counter's
// clocks, counters and groups) is a header with those under it, which it folds open and closed; each is added by itself.
// A panel that lists nothing is added as a whole. What the setup holds shows a gear (the item's settings) and an eye (hide
// on the canvas only) in place of the +. Panels that can't go in aren't listed. The list keeps its order whatever is added or
// removed, and the search only filters it; when the search finds nothing addable but does match a panel that can't be used,
// one quiet line says why.
import { ChevronDown, ChevronRight, Eye, EyeOff, Link, Plus, Settings } from "@lucide/vue";
import { computed, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { cn } from "@/lib/utils";
import type { SourceBlock } from "../../../shared/layout-view";
import { t } from "../../i18n";
import ModuleIcon from "../ModuleIcon.vue";
import { send, view } from "./layout-state";

interface Row {
  key: string;
  /** A panel with a list of its own (a header), a thing on such a list, or a panel added as a whole. */
  type: "header" | "thing" | "panel" | "item";
  name: string;
  /** The line under the name: the workspace for a panel, "Linked group" for a group. */
  sub: string | null;
  moduleId: string;
  group: boolean;
  /** The item of the setup this row is, else null. */
  item: string | null;
  hidden: boolean;
  /** What a click adds: the panel's id and, for a thing, its key; null when nothing can be added here. */
  add: { id: string; key?: string } | null;
  /** The panel this row belongs to (a header's own id). */
  panel: string;
}

const query = ref("");
/** Headers folded shut; everything starts open, and nothing here changes by itself. */
const folded = ref<ReadonlySet<string>>(new Set());

const current = computed(() => view.value);
const hiddenOf = (id: string | null) => (id ? (current.value?.items.find((item) => item.id === id)?.hiddenOnCanvas ?? false) : false);

/** Every row that is in the setup or can be added, in the order the main process lists the panels and each panel its things. */
const all = computed<Row[]>(() => {
  const state = current.value;
  if (!state) return [];
  const inSetup = new Map(state.items.filter((item) => item.target.kind === "panel").map((item) => [item.target.kind === "panel" ? item.target.instanceId : "", item]));
  const rows: Row[] = [];
  const listed = new Set<string>();
  for (const source of state.sources) {
    if (source.children) {
      const things = source.children.filter((child) => child.item !== null || child.block === null);
      if (!things.length) continue;
      rows.push({ key: source.id, type: "header", name: source.name, sub: source.from, moduleId: source.moduleId, group: false, item: null, hidden: false, add: null, panel: source.id });
      for (const child of things) {
        if (child.item) listed.add(child.item);
        rows.push({
          key: `${source.id}:${child.key}`,
          type: "thing",
          name: child.name,
          sub: child.group ? t("overlays.layout.group") : null,
          moduleId: source.moduleId,
          group: child.group,
          item: child.item,
          hidden: hiddenOf(child.item),
          add: child.item ? null : { id: source.id, key: child.key },
          panel: source.id,
        });
      }
      continue;
    }
    const item = inSetup.get(source.id) ?? null;
    if (!item && source.block !== null) continue;
    if (item) listed.add(item.id);
    rows.push({ key: source.id, type: "panel", name: source.name, sub: source.from, moduleId: source.moduleId, group: false, item: item?.id ?? null, hidden: item?.hiddenOnCanvas ?? false, add: item ? null : { id: source.id }, panel: source.id });
  }
  // What the setup holds that no panel lists (its panel isn't running, the thing is gone from it, or it is a whole panel from before
  // its panel listed things) still has its row, last.
  for (const item of state.items) {
    if (listed.has(item.id)) continue;
    rows.push({ key: item.id, type: "item", name: item.name, sub: item.from, moduleId: item.moduleId, group: false, item: item.id, hidden: item.hiddenOnCanvas, add: null, panel: item.id });
  }
  return rows;
});

/** The rows shown: the search only takes rows away. A header stays while it or one of its things matches. */
const shown = computed<Row[]>(() => {
  const text = query.value.trim().toLowerCase();
  const matches = (row: Row) => `${row.name} ${row.sub ?? ""}`.toLowerCase().includes(text);
  if (!text) return all.value.filter((row) => row.type !== "thing" || !folded.value.has(row.panel));
  const headers = new Map(all.value.filter((row) => row.type === "header").map((row) => [row.panel, row]));
  return all.value.filter((row) => {
    if (row.type === "header") return matches(row) || all.value.some((other) => other.type === "thing" && other.panel === row.panel && matches(other));
    if (row.type === "thing") return matches(row) || (headers.has(row.panel) && matches(headers.get(row.panel)!));
    return matches(row);
  });
});

const count = computed(() => current.value?.items.length ?? 0);

/** One quiet line when the search finds nothing to add but names a panel that can't be used here, with why. */
const blockedLine = computed<string | null>(() => {
  const text = query.value.trim().toLowerCase();
  const state = current.value;
  if (!text || !state || shown.value.length) return null;
  for (const source of state.sources) {
    if (!`${source.name} ${source.from}`.toLowerCase().includes(text)) continue;
    const block: SourceBlock | null = source.block;
    if (block === null || block === "in-setup") continue;
    return t("overlays.layout.blockedLine", { name: source.name, reason: t(`overlays.layout.block.${block}`, { game: source.game ?? "" }) });
  }
  return null;
});

function toggleFold(panel: string) {
  const next = new Set(folded.value);
  if (!next.delete(panel)) next.add(panel);
  folded.value = next;
}

function press(row: Row) {
  if (row.type === "header") toggleFold(row.panel);
  else if (row.item) send({ type: "select", id: current.value?.selection === row.item ? null : row.item });
  else if (row.add) send({ type: "add-source", ...row.add });
}

const selected = (row: Row) => row.item !== null && current.value?.selection === row.item;
</script>

<template>
  <section class="bg-card flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-lg border py-3 pr-3 pl-3" :aria-label="t('overlays.layout.sources')" data-testid="layout-sources">
    <div class="flex items-baseline justify-between px-1">
      <h2 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{{ t("overlays.layout.sources") }}</h2>
      <span class="text-muted-foreground text-xs" data-testid="layout-count">{{ t("overlays.layout.count", { count, max: current?.limit ?? 0 }) }}</span>
    </div>
    <Input v-model="query" type="search" :placeholder="t('overlays.layout.search')" :aria-label="t('overlays.layout.search')" data-testid="layout-search" />
    <p v-if="!shown.length" class="text-muted-foreground px-1 py-2 text-sm" :data-testid="blockedLine ? 'layout-blocked' : 'layout-empty'">{{ blockedLine ?? (query ? t("overlays.layout.noSources") : t("overlays.layout.nothing")) }}</p>
    <div v-else class="-mr-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]" data-testid="layout-sources-list">
      <ul class="flex flex-col gap-1">
        <li
          v-for="row in shown"
          :key="row.key"
          :class="cn('flex items-center gap-1 rounded-md border', selected(row) ? 'border-primary bg-primary/5' : 'hover:bg-accent border-transparent', row.type === 'thing' && 'ml-6')"
          :data-testid="`layout-source-${row.key}`"
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2"
            :aria-pressed="row.item ? selected(row) : undefined"
            :aria-expanded="row.type === 'header' ? !folded.has(row.panel) : undefined"
            :aria-label="row.type === 'header' ? t(folded.has(row.panel) ? 'overlays.layout.expand' : 'overlays.layout.collapse', { name: row.name }) : row.add ? t('overlays.layout.addSource', { name: row.name }) : undefined"
            @click="press(row)"
          >
            <component :is="folded.has(row.panel) ? ChevronRight : ChevronDown" v-if="row.type === 'header'" class="text-muted-foreground -ml-1 size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
            <Link v-if="row.group" class="text-muted-foreground size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
            <ModuleIcon v-else :module-id="row.moduleId" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{{ row.name }}</span>
              <span v-if="row.sub" class="text-muted-foreground block truncate text-xs">{{ row.sub }}</span>
            </span>
            <Plus v-if="row.add" class="text-muted-foreground size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
          </button>
          <template v-if="row.item">
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="t('overlays.layout.settingsNamed', { name: row.name })"
              :title="t('overlays.layout.settings')"
              :data-testid="`layout-gear-${row.item}`"
              @click="send({ type: 'select', id: row.item }), send({ type: 'settings', id: row.item })"
            >
              <Settings :stroke-width="1.5" />
            </Button>
            <Button
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
          </template>
        </li>
      </ul>
    </div>
  </section>
</template>
