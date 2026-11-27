<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { Map, Pin, Swords } from "@lucide/vue";
import { ref } from "vue";

const tiles = [
  { name: "Maps", icon: Map },
  { name: "Builds", icon: Swords },
];
const pinned = ref(true);
</script>

<template>
  <div class="flex flex-wrap items-center gap-2" data-testid="bare-buttons">
    <Button v-for="tile in tiles" :key="tile.name" variant="bare" class="bg-card hover:bg-accent flex-col gap-1 rounded-lg border px-4 py-3 text-sm">
      <component :is="tile.icon" class="text-primary size-5" />
      {{ tile.name }}
    </Button>
    <!-- A tile that stays on draws its own on state, which every style leaves alone. -->
    <Button variant="bare" class="bg-card hover:bg-accent aria-pressed:border-primary aria-pressed:bg-primary/10 flex-col gap-1 rounded-lg border px-4 py-3 text-sm" :aria-pressed="pinned" data-testid="bare-pressed" @click="pinned = !pinned">
      <Pin class="text-primary size-5" />
      Pinned
    </Button>
    <Button variant="bare" class="text-muted-foreground hover:text-foreground rounded-md">No tile at all</Button>
  </div>
</template>
