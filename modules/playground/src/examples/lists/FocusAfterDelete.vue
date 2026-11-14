<script setup lang="ts">
// useFocusRecovery keeps the focus in the list when its row is deleted: the next row at the same spot, else the one
// before, else the empty state's button. Undo (undoable) brings the row back with the focus.
import { Trash2 } from "@lucide/vue";
import { useFocusRecovery } from "@tavora/official-ui";
import { AnimatedList } from "@tavora/official-ui/components/ui/animated-list";
import { Button } from "@tavora/official-ui/components/ui/button";
import { undoable } from "@tavora/official-ui/components/ui/toast";
import { ref } from "vue";

const ALL = ["Iron ore", "Copper ore", "Coal", "Limestone"];
const items = ref([...ALL]);
const list = ref<HTMLElement | null>(null);
const focus = useFocusRecovery(list);

function remove(name: string) {
  const index = items.value.indexOf(name);
  items.value = items.value.filter((item) => item !== name);
  undoable({
    title: `${name} deleted`,
    undo: () => {
      if (items.value.includes(name)) return false;
      const next = [...items.value];
      next.splice(Math.min(index, next.length), 0, name);
      items.value = next;
      focus.restore(name);
    },
  });
}
</script>

<template>
  <div ref="list" class="flex flex-col" data-testid="focus-after-delete">
    <AnimatedList tag="ul" aria-label="Resources" class="flex flex-col">
      <li v-for="name in items" :key="name" class="flex min-h-10 items-center gap-2 border-b py-1 last:border-b-0" :data-focus-row="name">
        <Button variant="ghost" size="sm" class="min-w-0 flex-1 justify-start">{{ name }}</Button>
        <Button size="icon-xs" variant="ghost" :aria-label="`Delete ${name}`" :title="`Delete ${name}`" @click="remove(name)"><Trash2 :stroke-width="1.5" /></Button>
      </li>
    </AnimatedList>
    <div v-if="!items.length" class="flex flex-col items-start gap-2 py-2" data-focus-empty>
      <p class="text-muted-foreground text-sm">Nothing left.</p>
      <Button variant="secondary" size="sm" @click="items = [...ALL]">Bring them back</Button>
    </div>
  </div>
</template>
