<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button>Primary</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="outline">Outline</Button>
    <Button variant="ghost">Ghost</Button>
    <Button variant="destructive">Delete for good</Button>
    <Button variant="danger">Remove</Button>
    <Button variant="link">Link</Button>
  </div>
</template>
