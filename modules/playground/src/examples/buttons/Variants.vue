<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";

defineProps<{ disabled?: boolean }>();
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button :disabled="disabled">Primary</Button>
    <Button variant="secondary" :disabled="disabled">Secondary</Button>
    <Button variant="outline" :disabled="disabled">Outline</Button>
    <Button variant="ghost" :disabled="disabled">Ghost</Button>
    <Button variant="destructive" :disabled="disabled">Delete for good</Button>
    <Button variant="danger" :disabled="disabled">Remove</Button>
    <Button variant="link" :disabled="disabled">Link</Button>
  </div>
</template>
