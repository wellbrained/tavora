<script setup lang="ts">
// Numbers that change (a timer, a count, a total) keep every digit the same width, so they don't wobble.
import { t } from "../../i18n";

const TIMES = ["11:11:11", "08:08:08", "01:07:42"];
</script>

<template>
  <div class="flex flex-wrap gap-x-10 gap-y-4">
    <div class="flex flex-col gap-1">
      <code class="text-muted-foreground font-mono text-xs">tabular-nums</code>
      <p v-for="time in TIMES" :key="time" class="text-sm tabular-nums">{{ time }}</p>
    </div>
    <div class="flex flex-col gap-1">
      <span class="text-muted-foreground text-xs">{{ t("demo.text.notSet") }}</span>
      <p v-for="time in TIMES" :key="time" class="text-sm">{{ time }}</p>
    </div>
  </div>
</template>
