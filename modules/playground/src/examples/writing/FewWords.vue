<script setup lang="ts">
// Titles, labels and buttons are a few words.
import { Check, X } from "@lucide/vue";
import { t } from "../../i18n";

interface Line {
  en: string;
  de: string;
}
const PAIRS: { good: Line; bad: Line }[] = [
  {
    good: { en: "Save", de: "Speichern" },
    bad: { en: "Click here to save your changes", de: "Hier klicken, um die Änderungen zu speichern" },
  },
  {
    good: { en: "Your builds", de: "Deine Builds" },
    bad: { en: "Overview of all the builds you have saved", de: "Übersicht über alle von dir gespeicherten Builds" },
  },
  {
    good: { en: "Add a build", de: "Build hinzufügen" },
    bad: { en: "Add a new build to your list now", de: "Jetzt einen neuen Build zu deiner Liste hinzufügen" },
  },
];
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="text-muted-foreground hidden grid-cols-2 gap-6 text-xs font-medium sm:grid">
      <span class="text-success flex items-center gap-1.5"><Check class="size-4" :stroke-width="1.5" /> {{ t("demo.do") }}</span>
      <span class="text-destructive flex items-center gap-1.5"><X class="size-4" :stroke-width="1.5" /> {{ t("demo.dont") }}</span>
    </div>
    <div v-for="pair in PAIRS" :key="pair.good.en" class="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      <p class="flex flex-col gap-0.5 text-sm">
        <span><span class="text-muted-foreground mr-2 font-mono text-xs">EN</span>{{ pair.good.en }}</span>
        <span><span class="text-muted-foreground mr-2 font-mono text-xs">DE</span>{{ pair.good.de }}</span>
      </p>
      <p class="text-muted-foreground flex flex-col gap-0.5 text-sm">
        <span><span class="mr-2 font-mono text-xs">EN</span>{{ pair.bad.en }}</span>
        <span><span class="mr-2 font-mono text-xs">DE</span>{{ pair.bad.de }}</span>
      </p>
    </div>
  </div>
</template>
