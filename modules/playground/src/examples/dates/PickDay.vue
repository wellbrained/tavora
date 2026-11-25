<script setup lang="ts">
import { Calendar } from "@tavora/official-ui/components/ui/calendar";
import { ref } from "vue";

const day = ref<string>();
</script>

<template>
  <div class="flex max-w-72 flex-col gap-2">
    <Calendar v-model="day" label="Pick a day" />
    <span class="text-muted-foreground text-xs tabular-nums">{{ day ?? "No day picked" }}</span>
  </div>
</template>
