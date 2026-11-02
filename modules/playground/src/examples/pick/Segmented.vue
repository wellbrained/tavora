<script setup lang="ts">
import { SegmentedControl } from "@tavora/official-ui";
import { ref } from "vue";

const period = ref<"day" | "week" | "month">("week");
</script>

<template>
  <SegmentedControl
    v-model="period"
    label="Period"
    :options="[
      { value: 'day', label: 'Day' },
      { value: 'week', label: 'Week' },
      { value: 'month', label: 'Month' },
    ]"
  />
</template>
