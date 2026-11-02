<script setup lang="ts">
import { Plus, X } from "@lucide/vue";
import { AnimatedList } from "@tavora/official-ui/components/ui/animated-list";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const WORKS = ["Boss checklist", "Atlas strategy", "Trade notes", "Crafting plan", "Farming route", "Build ideas", "Loot filter"];
let worksMade = 3;
const works = ref(WORKS.slice(0, 3).map((title, id) => ({ id, title })));
function addWork() {
  works.value = [...works.value, { id: worksMade, title: WORKS[worksMade % WORKS.length]! }];
  worksMade += 1;
}
function removeWork(id: number) {
  works.value = works.value.filter((work) => work.id !== id);
}
/** A whole new list at once: it changes without moving. */
function replaceWorks() {
  works.value = [0, 1, 2, 3].map((n) => ({ id: worksMade + n, title: WORKS[(worksMade + n) % WORKS.length]! }));
  worksMade += 4;
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <Button variant="secondary" :disabled="off" data-testid="animated-list-add" @click="addWork"><Plus :stroke-width="1.5" /> Add a row</Button>
      <Button variant="ghost" :disabled="off" data-testid="animated-list-replace" @click="replaceWorks">Replace the whole list</Button>
    </div>
    <AnimatedList tag="ul" aria-label="Rows added and removed" class="flex flex-col" data-testid="animated-list">
      <li v-for="work in works" :key="work.id" class="flex min-h-10 items-center gap-2 border-b py-1 last:border-b-0">
        <span class="min-w-0 flex-1 truncate text-sm">{{ work.title }}</span>
        <Button size="icon-xs" variant="ghost" :disabled="off" :aria-label="`Remove ${work.title}`" @click="removeWork(work.id)"><X :stroke-width="1.5" /></Button>
      </li>
    </AnimatedList>
  </div>
</template>
