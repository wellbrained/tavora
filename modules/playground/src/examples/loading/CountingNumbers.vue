<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { CountTo } from "@tavora/official-ui/components/ui/count-to";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

const progress = ref(45);
const bump = (by: number) => (progress.value = Math.min(100, Math.max(0, progress.value + by)));
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm"><CountTo :value="progress * 24" /> items</span>
      <span class="text-sm"><CountTo :value="progress / 20" kind="decimal" /> average</span>
      <span class="text-sm"><CountTo :value="progress / 100" kind="percent" /> done</span>
      <span class="text-sm"><CountTo :value="progress" :format="(n) => n + ' left'" /></span>
    </div>
    <div class="flex gap-2">
      <Button size="xs" variant="secondary" :disabled="disabled" @click="bump(-15)">Less</Button>
      <Button size="xs" variant="secondary" :disabled="disabled" @click="bump(15)">More</Button>
    </div>
  </div>
</template>
