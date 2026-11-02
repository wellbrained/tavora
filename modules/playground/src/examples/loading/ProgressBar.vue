<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { Progress } from "@tavora/official-ui/components/ui/progress";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

const progress = ref(45);
const bump = (by: number) => (progress.value = Math.min(100, Math.max(0, progress.value + by)));
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-3">
      <Progress :model-value="progress" class="max-w-64" aria-label="Import progress" />
      <span class="text-muted-foreground text-xs tabular-nums">{{ progress }}%</span>
    </div>
    <div class="flex gap-2">
      <Button size="xs" variant="secondary" :disabled="disabled" @click="bump(-15)">Less</Button>
      <Button size="xs" variant="secondary" :disabled="disabled" @click="bump(15)">More</Button>
    </div>
  </div>
</template>
