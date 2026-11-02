<script setup lang="ts">
import { Download, FolderOpen, StickyNote } from "@lucide/vue";
import { ActionList, type ActionEntry } from "@tavora/official-ui/components/ui/action-list";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import { ref } from "vue";

const started = ref("");
const START: ActionEntry[] = [
  { id: "import", label: "Import a build", description: "Start from a file on your PC.", icon: FolderOpen, testid: "start-import" },
  { id: "export", label: "Browse shared builds", description: "Find one other players made.", icon: Download },
  { id: "later", label: "Not yet available", description: "Comes with a later update.", icon: StickyNote, disabled: true },
];
</script>

<template>
  <div class="flex flex-col gap-2">
    <EmptyState title="No build yet" description="Start in one of these ways.">
      <template #icon><StickyNote :stroke-width="1.5" /></template>
      <template #action><ActionList :entries="START" @select="started = $event" /></template>
    </EmptyState>
    <p class="text-muted-foreground text-xs" data-testid="action-list-picked">Picked: {{ started || "nothing yet" }}</p>
  </div>
</template>
