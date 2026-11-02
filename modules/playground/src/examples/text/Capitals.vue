<script setup lang="ts">
// Sentence case: only the first word starts uppercase. In a short "A & B" name both words do.
import { Check, X } from "@lucide/vue";
import { t } from "../../i18n";

const RIGHT = ["Save changes", "Add a build", "Updates & About"];
const WRONG = ["SAVE CHANGES", "Add A Build", "Updates & about"];
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2">
    <div class="flex flex-col gap-2">
      <p class="text-success flex items-center gap-1.5 text-xs font-medium"><Check class="size-4" :stroke-width="1.5" /> {{ t("demo.do") }}</p>
      <ul class="flex flex-col gap-1 text-sm">
        <li v-for="text in RIGHT" :key="text">{{ text }}</li>
      </ul>
    </div>
    <div class="flex flex-col gap-2">
      <p class="text-destructive flex items-center gap-1.5 text-xs font-medium"><X class="size-4" :stroke-width="1.5" /> {{ t("demo.dont") }}</p>
      <ul class="text-muted-foreground flex flex-col gap-1 text-sm">
        <li v-for="text in WRONG" :key="text">{{ text }}</li>
      </ul>
    </div>
  </div>
</template>
