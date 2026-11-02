<script setup lang="ts">
import { SegmentedControl } from "@tavora/official-ui";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const segmentMany = ref<"all" | "open" | "done" | "archived">("open");
</script>

<template>
  <SegmentedControl
    v-model="segmentMany"
    label="Show"
    :disabled="off"
    data-testid="segmented-many"
    :options="[
      { value: 'all', label: 'All' },
      { value: 'open', label: 'Still to do' },
      { value: 'done', label: 'Done' },
      { value: 'archived', label: 'Archived for later' },
    ]"
  />
</template>
