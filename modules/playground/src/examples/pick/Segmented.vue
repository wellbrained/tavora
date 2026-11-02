<script setup lang="ts">
import { SegmentedControl } from "@tavora/official-ui";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

const period = ref<"day" | "week" | "month">("week");
</script>

<template>
  <SegmentedControl
    v-model="period"
    label="Period"
    :disabled="disabled"
    :options="[
      { value: 'day', label: 'Day' },
      { value: 'week', label: 'Week' },
      { value: 'month', label: 'Month' },
    ]"
  />
</template>
