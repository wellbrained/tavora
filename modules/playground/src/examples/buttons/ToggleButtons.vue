<script setup lang="ts">
import { Bold, Italic } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";

defineProps<{ disabled?: boolean }>();
</script>

<template>
  <div class="bg-background inline-flex gap-0.5 rounded-lg border p-0.5">
    <Button size="icon-sm" variant="ghost" aria-label="Bold" title="Bold" :aria-pressed="true" class="bg-secondary" :disabled="disabled"><Bold :stroke-width="1.5" /></Button>
    <Button size="icon-sm" variant="ghost" aria-label="Italic" title="Italic" :aria-pressed="false" :disabled="disabled"><Italic :stroke-width="1.5" /></Button>
  </div>
</template>
