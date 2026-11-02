<script setup lang="ts">
// A rounded item close inside a rounded area (a 4 px gap here): give the inner one the step nearest to the outer
// radius minus the gap, so the corners run parallel. Here that is rounded-lg minus 4 px = rounded-sm.
import { Check, X } from "@lucide/vue";
import { t } from "../../i18n";
</script>

<template>
  <div class="flex flex-wrap gap-x-8 gap-y-4">
    <figure class="flex flex-col gap-2">
      <figcaption class="text-success flex items-center gap-1.5 text-xs font-medium"><Check class="size-4" :stroke-width="1.5" /> {{ t("demo.do") }}</figcaption>
      <div class="bg-secondary flex w-48 flex-col gap-1 rounded-lg p-1">
        <div class="bg-background rounded-sm px-3 py-2 text-sm">Notes</div>
        <div class="bg-background rounded-sm px-3 py-2 text-sm">To-dos</div>
      </div>
      <code class="text-muted-foreground font-mono text-xs">rounded-lg &gt; p-1 &gt; rounded-sm</code>
    </figure>
    <figure class="flex flex-col gap-2">
      <figcaption class="text-destructive flex items-center gap-1.5 text-xs font-medium"><X class="size-4" :stroke-width="1.5" /> {{ t("demo.dont") }}</figcaption>
      <div class="bg-secondary flex w-48 flex-col gap-1 rounded-lg p-1">
        <div class="bg-background rounded-lg px-3 py-2 text-sm">Notes</div>
        <div class="bg-background rounded-lg px-3 py-2 text-sm">To-dos</div>
      </div>
      <code class="text-muted-foreground font-mono text-xs">rounded-lg &gt; p-1 &gt; rounded-lg</code>
    </figure>
  </div>
</template>
