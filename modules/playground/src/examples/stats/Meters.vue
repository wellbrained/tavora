<script setup lang="ts">
// An amount with the number beside it. One runs low, one fills up (each changes colour at its limits), one is a share
// in a neutral colour. The sizes are the same bar at 4, 6 and 8 px.
import { Button } from "@tavora/official-ui/components/ui/button";
import { Meter } from "@tavora/official-ui/components/ui/meter";
import { computed, ref } from "vue";
import { t } from "../../i18n";

const used = ref(55);
const bump = (by: number) => (used.value = Math.min(100, Math.max(0, used.value + by)));
const left = computed(() => 100 - used.value);
const leftText = computed(() => t("demo.meter.left", { percent: String(left.value) }));
const usedText = computed(() => t("demo.meter.used", { percent: String(used.value) }));
const shareText = computed(() => t("demo.meter.share"));
</script>

<template>
  <div class="flex max-w-sm flex-col gap-3">
    <div class="grid grid-cols-[5rem_minmax(0,1fr)_6rem] items-center gap-2 text-sm">
      <span class="truncate">{{ t("demo.meter.allowance") }}</span>
      <Meter :model-value="left" tone="success" :warning-up-to="30" :destructive-up-to="10" :aria-label="t('demo.meter.allowance')" :value-text="leftText" />
      <span class="text-xs tabular-nums">{{ leftText }}</span>
      <span class="truncate">{{ t("demo.meter.drive") }}</span>
      <Meter :model-value="used" tone="muted" :warning-from="80" :destructive-from="95" :aria-label="t('demo.meter.drive')" :value-text="usedText" />
      <span class="text-xs tabular-nums">{{ usedText }}</span>
    </div>
    <div class="flex gap-2">
      <Button size="xs" variant="secondary" @click="bump(-15)">{{ t("demo.meter.useLess") }}</Button>
      <Button size="xs" variant="secondary" @click="bump(15)">{{ t("demo.meter.useMore") }}</Button>
    </div>
    <div class="flex flex-col gap-2">
      <Meter v-for="size in ['sm', 'default', 'lg'] as const" :key="size" :model-value="64" :size="size" :aria-label="`${shareText} (${size})`" />
    </div>
  </div>
</template>
