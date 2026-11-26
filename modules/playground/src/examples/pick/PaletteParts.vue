<script setup lang="ts">
// The big search list's parts, for a page that keeps its own search, order and highlight (Tavora's Ctrl+K search):
// PaletteSearch drives a PaletteList of PaletteGroups and PaletteItems; PaletteFooter shows the keys. Picking "Add"
// takes a moment here: the row spins until it is done.
import { Plus, Settings, SlidersHorizontal } from "@lucide/vue";
import { PaletteFooter, PaletteGroup, PaletteItem, PaletteList, PaletteSearch } from "@tavora/official-ui/components/ui/palette";
import { computed, ref, watch, type Component } from "vue";

interface Row { id: string; label: string; hint?: string; icon: Component; group: string }
const ROWS: Row[] = [
  { id: "settings", label: "Settings", icon: Settings, group: "Actions" },
  { id: "theme", label: "Theme", hint: "Appearance", icon: SlidersHorizontal, group: "Settings" },
  { id: "palia", label: "Add Palia", hint: "New game", icon: Plus, group: "Add a game" },
  { id: "pal-hunters", label: "Add Pal Hunters", hint: "New game", icon: Plus, group: "Add a game" },
];

const query = ref("");
const shown = computed(() => ROWS.filter((row) => row.label.toLowerCase().includes(query.value.trim().toLowerCase())));
const groups = computed(() => [...new Set(shown.value.map((row) => row.group))].map((label) => ({ label, rows: shown.value.filter((row) => row.group === label) })));
const active = ref(0);
watch(query, () => (active.value = 0));
const busy = ref<string | null>(null);
const done = ref<string[]>([]);

function pick(row: Row | undefined) {
  if (!row || busy.value) return;
  busy.value = row.id;
  setTimeout(() => {
    busy.value = null;
    done.value.push(row.label);
  }, 1200);
}

function onKey(event: KeyboardEvent) {
  const count = shown.value.length;
  if (!count) return;
  if (event.key === "ArrowDown") active.value = (active.value + 1) % count;
  else if (event.key === "ArrowUp") active.value = (active.value - 1 + count) % count;
  else if (event.key === "Enter") pick(shown.value[active.value]);
  else return;
  event.preventDefault();
}
</script>

<template>
  <div class="flex w-full max-w-lg flex-col gap-2">
    <div class="bg-card flex flex-col overflow-hidden rounded-xl border">
      <PaletteSearch v-model="query" list="parts-results" :active-id="shown[active] ? `parts-${shown[active]!.id}` : undefined" placeholder="Search or jump to" aria-label="Search" @keydown="onKey" />
      <PaletteList id="parts-results" label="Results" :busy="busy !== null" class="max-h-72 overflow-y-auto">
        <p v-if="!shown.length" class="text-muted-foreground px-3 py-6 text-center text-sm">Nothing matches.</p>
        <PaletteGroup v-for="group in groups" :key="group.label" :label="group.label">
          <PaletteItem
            v-for="row in group.rows"
            :id="`parts-${row.id}`"
            :key="row.id"
            :icon="row.icon"
            :label="row.label"
            :match="query"
            :active="shown[active] === row"
            :busy="busy === row.id"
            @mousemove="active = shown.indexOf(row)"
            @click="pick(row)"
          >
            <template v-if="row.hint" #trailing>{{ row.hint }}</template>
          </PaletteItem>
        </PaletteGroup>
      </PaletteList>
      <PaletteFooter :hints="[{ keys: ['↑', '↓'], label: 'to move' }, { keys: ['Enter'], label: 'to open' }]" />
    </div>
    <PaletteSearch variant="field" placeholder="Search Tavora" aria-label="Search Tavora" />
    <p class="text-muted-foreground text-xs">Done: {{ done.join(", ") || "nothing yet" }}</p>
  </div>
</template>
