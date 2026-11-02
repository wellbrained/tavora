<script setup lang="ts">
// Undo instead of "Are you sure?" (undoable in the kit): gone at once, then "… deleted" with Undo for a few seconds.
// Each delete has its own toast; Undo puts back only its own, in its place.
import { Trash2 } from "@lucide/vue";
import { ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { undoable } from "@tavora/official-ui/components/ui/toast";

defineProps<{ disabled?: boolean }>();

const ALL = ["Iron", "Copper", "Coal"];
const items = ref([...ALL]);

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
    },
  });
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button v-for="name in items" :key="name" variant="secondary" :disabled="disabled" @click="remove(name)"><Trash2 />{{ name }}</Button>
    <Button v-if="!items.length" variant="ghost" :disabled="disabled" @click="items = [...ALL]">Bring them back</Button>
  </div>
</template>
