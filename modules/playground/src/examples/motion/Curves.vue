<script setup lang="ts">
// The kit's three curves, from motion.css. Play moves a dot across with each one (translate only).
import { Play } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { reactive } from "vue";
import { t } from "../../i18n";
import type { TextKey } from "../../locales";

defineProps<{ disabled?: boolean }>();

const CURVES: { token: string; use: TextKey }[] = [
  { token: "--ease-out-strong", use: "demo.motion.outStrong" },
  { token: "--ease-in-out-strong", use: "demo.motion.inOutStrong" },
  { token: "--ease-spring", use: "demo.motion.spring" },
];
const moved = reactive<Record<string, boolean>>({});
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-for="curve in CURVES" :key="curve.token" class="flex flex-wrap items-center gap-x-4 gap-y-2" :data-token="curve.token">
      <div class="flex w-52 flex-col">
        <code class="font-mono text-xs">{{ curve.token }}</code>
        <span class="text-muted-foreground text-xs">{{ t(curve.use) }}</span>
      </div>
      <div class="bg-secondary relative h-6 w-32 flex-none rounded-full">
        <span
          class="bg-primary absolute top-1 left-1 size-4 rounded-full transition-[translate]"
          :class="moved[curve.token] ? 'translate-x-24' : 'translate-x-0'"
          :style="{ transitionDuration: 'var(--duration-move)', transitionTimingFunction: `var(${curve.token})` }"
          data-testid="demo-dot"
        />
      </div>
      <Button variant="ghost" size="xs" :disabled="disabled" @click="moved[curve.token] = !moved[curve.token]"><Play :stroke-width="1.5" /> {{ t("demo.motion.play") }}</Button>
    </div>
  </div>
</template>
