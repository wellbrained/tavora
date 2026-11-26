<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { Map, Swords } from "@lucide/vue";

const tiles = [
  { name: "Maps", icon: Map },
  { name: "Builds", icon: Swords },
];
</script>

<template>
  <div class="flex flex-wrap items-center gap-2" data-testid="bare-buttons">
    <Button v-for="tile in tiles" :key="tile.name" variant="bare" class="bg-card hover:bg-accent flex-col gap-1 rounded-lg border px-4 py-3 text-sm">
      <component :is="tile.icon" class="text-primary size-5" />
      {{ tile.name }}
    </Button>
    <Button variant="bare" class="text-muted-foreground hover:text-foreground rounded-md">No tile at all</Button>
  </div>
</template>
