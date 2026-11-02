<script setup lang="ts">
// Deleting something easy to put back: delete at once, then undoable() shows the toast with Undo (and Ctrl+Z where the
// page binds it). Each delete gets its own toast; after five seconds it is final.
import { undoable } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { toast } from "@tavora/official-ui/components/ui/toast";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

const left = ref(3);
function deleteOne() {
  if (left.value === 0) left.value = 3;
  left.value--;
  undoable({ title: "To-do deleted", undo: () => void left.value++ });
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="secondary" :disabled="disabled" data-testid="undoable-delete" @click="deleteOne">With Undo ({{ left }} left)</Button>
    <Button variant="secondary" :disabled="disabled" @click="toast({ title: 'Deleted “Shopping”', duration: 10000, action: { label: 'Undo', onClick: () => toast({ title: 'Brought back' }) } })">Long Undo (10 s)</Button>
    <Button variant="secondary" :disabled="disabled" @click="toast({ title: 'Note deleted', description: '“Boss route” is gone.' })">Second line</Button>
  </div>
</template>
