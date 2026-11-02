<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button size="xs">Extra small</Button>
    <Button size="xs" variant="secondary">Extra small</Button>
    <Button size="sm" variant="secondary">Small</Button>
    <Button variant="secondary">Default</Button>
    <Button size="lg" variant="secondary">Large</Button>
  </div>
</template>
