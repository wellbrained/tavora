<script setup lang="ts">
// The theme's two fonts. Write the class (or var(--font-sans) / var(--font-mono) in CSS), never a font's name.
import { t } from "../../i18n";
</script>

<template>
  <div class="grid grid-cols-[11rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-3">
    <p class="text-muted-foreground flex flex-col font-mono text-xs">
      <span class="text-foreground">font-sans</span>
      <span>{{ t("demo.text.sans") }}</span>
    </p>
    <p class="font-sans text-sm">Save your changes</p>
    <p class="text-muted-foreground flex flex-col font-mono text-xs">
      <span class="text-foreground">font-mono</span>
      <span>{{ t("demo.text.mono") }}</span>
    </p>
    <p class="flex flex-wrap items-center gap-2">
      <code class="bg-secondary rounded-sm px-1.5 py-0.5 font-mono text-sm">tavora.notes</code>
      <code class="bg-secondary rounded-sm px-1.5 py-0.5 font-mono text-sm">1.4.2</code>
      <code class="bg-secondary rounded-sm px-1.5 py-0.5 font-mono text-sm">a1b2c3d</code>
    </p>
  </div>
</template>
