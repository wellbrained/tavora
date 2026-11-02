<script setup lang="ts">
// The rules of motion in a few lines. Where they come from: motion.css and the module rules.
import { Check } from "@lucide/vue";
import { t } from "../../i18n";
import type { TextKey } from "../../locales";

const RULES: TextKey[] = ["demo.motion.ruleTime", "demo.motion.ruleEase", "demo.motion.ruleProperties", "demo.motion.ruleKeys", "demo.motion.ruleReduced"];
</script>

<template>
  <ul class="flex flex-col gap-2 text-sm">
    <li v-for="rule in RULES" :key="rule" class="flex items-start gap-2">
      <Check class="text-success mt-0.5 size-4 flex-none" :stroke-width="1.5" />
      <span>{{ t(rule) }}</span>
    </li>
  </ul>
</template>
