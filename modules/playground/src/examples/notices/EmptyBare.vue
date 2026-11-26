<script setup lang="ts">
import { Inbox } from "@lucide/vue";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
</script>

<template>
  <div class="bg-card flex h-56 flex-col rounded-lg border">
    <EmptyState variant="bare" fill title="No games yet" description="Add one to see it here.">
      <template #icon><Inbox /></template>
    </EmptyState>
  </div>
</template>
