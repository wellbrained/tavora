<script setup lang="ts">
import { Loader2 } from "@lucide/vue";
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Loader2 class="text-muted-foreground size-4 animate-spin" :stroke-width="1.5" />
    <span class="text-muted-foreground text-sm">Loading notes…</span>
  </div>
</template>
