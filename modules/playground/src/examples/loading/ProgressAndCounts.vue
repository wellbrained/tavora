<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { CountTo } from "@tavora/official-ui/components/ui/count-to";
import { Progress } from "@tavora/official-ui/components/ui/progress";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const progress = ref(45);
function bump(by: number) {
  progress.value = Math.min(100, Math.max(0, progress.value + by));
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-3">
        <Progress :model-value="progress" class="max-w-64" aria-label="Import progress" />
        <span class="text-muted-foreground text-xs tabular-nums">{{ progress }}%</span>
      </div>
      <div class="flex gap-2">
        <Button size="xs" variant="secondary" :disabled="off" @click="bump(-15)">Less</Button>
        <Button size="xs" variant="secondary" :disabled="off" @click="bump(15)">More</Button>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm"><CountTo :value="progress * 24" /> items</span>
      <span class="text-sm"><CountTo :value="progress / 20" kind="decimal" /> average</span>
      <span class="text-sm"><CountTo :value="progress / 100" kind="percent" /> done</span>
      <span class="text-sm"><CountTo :value="progress" :format="(n) => n + ' left'" /></span>
    </div>
  </div>
</template>
