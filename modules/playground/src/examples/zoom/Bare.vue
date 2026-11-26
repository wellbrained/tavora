<script setup lang="ts">
// A map that fills its panel: no frame of its own, and no zoom controls until there is something to zoom.
import { Button } from "@tavora/official-ui/components/ui/button";
import { ZoomPane } from "@tavora/official-ui/components/ui/zoom-pane";
import { ref } from "vue";

const loading = ref(true);
</script>

<template>
  <div class="flex flex-col items-start gap-2">
    <Button variant="outline" size="sm" @click="loading = !loading">{{ loading ? "Finish loading" : "Load again" }}</Button>
    <div class="bg-card w-full overflow-hidden rounded-md border">
      <ZoomPane class="h-64" bare :loading="loading" label="Bare map">
        <p v-if="loading" class="text-muted-foreground p-4 text-sm">Loading the map</p>
        <div v-else class="flex gap-4 p-4">
          <span v-for="name in ['Start', 'Village', 'Mine']" :key="name" class="bg-muted rounded-lg border px-4 py-3">{{ name }}</span>
        </div>
      </ZoomPane>
    </div>
  </div>
</template>
