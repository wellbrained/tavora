<script setup lang="ts">
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { ref } from "vue";

const role = ref("ranger");
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Select v-model="role">
      <SelectTrigger class="w-56" aria-label="Class" data-testid="select-empty">
        <SelectValue placeholder="Pick a class" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">No class</SelectItem>
        <SelectItem value="warrior">Warrior</SelectItem>
        <SelectItem value="ranger">Ranger</SelectItem>
      </SelectContent>
    </Select>
    <span class="text-muted-foreground text-xs" data-testid="select-empty-value">Value: {{ role === "" ? "(empty)" : role }}</span>
  </div>
</template>
