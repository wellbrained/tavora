<script setup lang="ts">
import { Plus, StickyNote } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
</script>

<template>
  <EmptyState title="No notes yet" description="Notes you write in this workspace show up here.">
    <template #icon><StickyNote /></template>
    <template #action><Button><Plus /> New note</Button></template>
  </EmptyState>
</template>
