<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";

defineProps<{ disabled?: boolean }>();
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button size="xs" :disabled="disabled">Extra small</Button>
    <Button size="xs" variant="secondary" :disabled="disabled">Extra small</Button>
    <Button size="sm" variant="secondary" :disabled="disabled">Small</Button>
    <Button variant="secondary" :disabled="disabled">Default</Button>
    <Button size="lg" variant="secondary" :disabled="disabled">Large</Button>
  </div>
</template>
