<script setup lang="ts">
import { Plus, StickyNote } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";

defineProps<{ disabled?: boolean }>();
</script>

<template>
  <EmptyState title="No notes yet" description="Notes you write in this workspace show up here.">
    <template #icon><StickyNote :stroke-width="1.5" /></template>
    <template #action><Button :disabled="disabled"><Plus :stroke-width="1.5" /> New note</Button></template>
  </EmptyState>
</template>
