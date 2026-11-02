<script setup lang="ts">
// AnimatedList moves the rows the user adds or removes; a whole new list changes without moving.
import { Plus, X } from "@lucide/vue";
import { AnimatedList } from "@tavora/official-ui/components/ui/animated-list";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

const TITLES = ["Boss checklist", "Atlas strategy", "Trade notes", "Crafting plan", "Farming route", "Build ideas", "Loot filter"];
let made = 3;
const rows = ref(TITLES.slice(0, 3).map((title, id) => ({ id, title })));

function add() {
  rows.value = [...rows.value, { id: made, title: TITLES[made % TITLES.length]! }];
  made += 1;
}
function remove(id: number) {
  rows.value = rows.value.filter((row) => row.id !== id);
}
function replaceAll() {
  rows.value = [0, 1, 2, 3].map((n) => ({ id: made + n, title: TITLES[(made + n) % TITLES.length]! }));
  made += 4;
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <Button variant="secondary" :disabled="disabled" data-testid="animated-list-add" @click="add"><Plus :stroke-width="1.5" /> Add a row</Button>
      <Button variant="ghost" :disabled="disabled" data-testid="animated-list-replace" @click="replaceAll">Replace the whole list</Button>
    </div>
    <AnimatedList tag="ul" aria-label="Rows added and removed" class="flex flex-col" data-testid="animated-list">
      <li v-for="row in rows" :key="row.id" class="flex min-h-10 items-center gap-2 border-b py-1 last:border-b-0">
        <span class="min-w-0 flex-1 truncate text-sm">{{ row.title }}</span>
        <Button size="icon-xs" variant="ghost" :disabled="disabled" :aria-label="`Remove ${row.title}`" @click="remove(row.id)"><X :stroke-width="1.5" /></Button>
      </li>
    </AnimatedList>
  </div>
</template>
