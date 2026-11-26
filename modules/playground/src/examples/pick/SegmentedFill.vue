<script setup lang="ts">
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { ref } from "vue";

const level = ref<"easy" | "medium" | "hard" | "expert">("medium");
</script>

<template>
  <div class="w-64 max-w-full">
    <SegmentedControl
      v-model="level"
      fill
      label="Level"
      :options="[
        { value: 'easy', label: 'Easy' },
        { value: 'medium', label: 'Medium' },
        { value: 'hard', label: 'Hard' },
        { value: 'expert', label: 'Expert' },
      ]"
    />
  </div>
</template>
