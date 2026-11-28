<script setup lang="ts">
import { MoreHorizontal } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ListRow } from "@tavora/official-ui/components/ui/list-row";
import { ref } from "vue";

const ROWS = [
  { id: "a", title: "Boss checklist", meta: "2 h ago" },
  { id: "b", title: "Atlas strategy", meta: "Yesterday" },
  { id: "c", title: "Trade notes", meta: "Oct 9" },
];
const selected = ref("b");
</script>

<template>
  <ul aria-label="Notes" class="flex flex-col">
    <li v-for="row in ROWS" :key="row.id" class="flex items-center gap-1">
      <ListRow class="min-w-0 flex-1" :selected="selected === row.id" @click="selected = row.id">
        {{ row.title }}
        <template #trailing>{{ row.meta }}</template>
      </ListRow>
      <Button size="icon-xs" variant="ghost" :aria-label="`More for ${row.title}`" title="More">
        <MoreHorizontal />
      </Button>
    </li>
  </ul>
</template>
