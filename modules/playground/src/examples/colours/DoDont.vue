<script setup lang="ts">
// The same card twice. The "don't" is only shown as code, never drawn: a hex colour or a palette colour looks right in
// one theme and breaks in another.
import { Check, X } from "@lucide/vue";
import { t } from "../../i18n";

const DO = `<div class="bg-card text-card-foreground border-border border">
  <p class="text-muted-foreground">Saved</p>
  <p class="text-warning">Low space</p>
</div>`;

const DONT = `<div class="bg-[#1b1b1b] text-white border-neutral-700 border">
  <p class="text-neutral-500">Saved</p>
  <p style="color: var(--warning, #f5c518)">Low space</p>
</div>`;
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2">
    <div class="flex flex-col gap-2">
      <p class="text-success flex items-center gap-1.5 text-xs font-medium"><Check class="size-4" :stroke-width="1.5" /> {{ t("demo.do") }}</p>
      <div class="bg-card text-card-foreground flex flex-col gap-0.5 rounded-md border p-3 text-sm">
        <p class="text-muted-foreground">Saved</p>
        <p class="text-warning">Low space</p>
      </div>
      <pre class="bg-muted/40 rounded-md p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap">{{ DO }}</pre>
    </div>
    <div class="flex flex-col gap-2">
      <p class="text-destructive flex items-center gap-1.5 text-xs font-medium"><X class="size-4" :stroke-width="1.5" /> {{ t("demo.dont") }}</p>
      <pre class="bg-muted/40 rounded-md p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap">{{ DONT }}</pre>
    </div>
  </div>
</template>
