<script setup lang="ts">
import { SegmentedControl } from "@tavora/official-ui";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const segment = ref<"day" | "week" | "month">("week");
</script>

<template>
  <SegmentedControl
    v-model="segment"
    label="Period"
    :disabled="off"
    :options="[
      { value: 'day', label: 'Day' },
      { value: 'week', label: 'Week' },
      { value: 'month', label: 'Month' },
    ]"
  />
</template>
