<script setup lang="ts">
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

const STYLES = [
  { value: "card", label: "Card" },
  { value: "bar", label: "Bar" },
  { value: "minimal", label: "Minimal" },
];
const style = ref("card");
</script>

<template>
  <Select v-model="style" :disabled="disabled">
    <SelectTrigger class="w-56" aria-label="Style"><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem v-for="option in STYLES" :key="option.value" :value="option.value">
        <template #thumb><span class="bg-muted relative h-5 w-8 flex-none rounded-sm border" aria-hidden="true"><span class="bg-muted-foreground/70 absolute inset-x-1 top-1.5 h-1 rounded-full" /></span></template>
        {{ option.label }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>
