<script setup lang="ts">
import { MoreHorizontal } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ref } from "vue";

const ROWS = [
  { id: "a", title: "Boss checklist", meta: "2 h ago" },
  { id: "b", title: "Atlas strategy", meta: "Yesterday" },
  { id: "c", title: "Trade notes", meta: "Oct 9" },
];
const selected = ref("b");
</script>

<template>
  <ul role="listbox" aria-label="Notes" class="flex flex-col">
    <li
      v-for="row in ROWS"
      :key="row.id"
      role="option"
      :aria-selected="selected === row.id"
      tabindex="0"
      :class="['group flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none', selected === row.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60']"
      @click="selected = row.id"
      @keydown.enter="selected = row.id"
    >
      <span class="min-w-0 flex-1 truncate">{{ row.title }}</span>
      <span class="text-muted-foreground text-xs">{{ row.meta }}</span>
      <Button size="icon-xs" variant="ghost" class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label="More" title="More" @click.stop>
        <MoreHorizontal :stroke-width="1.5" />
      </Button>
    </li>
  </ul>
</template>
