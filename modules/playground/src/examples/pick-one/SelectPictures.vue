<script setup lang="ts">
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const style = ref<"card" | "bar" | "minimal">("card");
const STYLES = [
  { value: "card" as const, label: "Card" },
  { value: "bar" as const, label: "Bar" },
  { value: "minimal" as const, label: "Minimal" },
];
</script>

<template>
  <Select v-model="style" :disabled="off">
    <SelectTrigger class="w-56" aria-label="Style"><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem v-for="option in STYLES" :key="option.value" :value="option.value">
        <template #thumb><span class="bg-muted relative h-5 w-8 flex-none rounded-sm border" aria-hidden="true"><span class="bg-muted-foreground/70 absolute inset-x-1 top-1.5 h-1 rounded-full" /></span></template>
        {{ option.label }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>
