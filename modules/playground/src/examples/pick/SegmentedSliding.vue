<script setup lang="ts">
// The pill slides when you click, and jumps with the arrow keys.
import { SegmentedControl } from "@tavora/official-ui";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

const shown = ref<"all" | "open" | "done" | "archived">("open");
</script>

<template>
  <SegmentedControl
    v-model="shown"
    label="Show"
    :disabled="disabled"
    data-testid="segmented-many"
    :options="[
      { value: 'all', label: 'All' },
      { value: 'open', label: 'Still to do' },
      { value: 'done', label: 'Done' },
      { value: 'archived', label: 'Archived for later' },
    ]"
  />
</template>
