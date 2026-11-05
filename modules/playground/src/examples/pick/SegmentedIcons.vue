<script setup lang="ts">
// An option can have an icon before its label, or show only the icon (the label is then its tooltip and name).
// A disabled option says why in its tooltip; it stays hoverable and focusable, but can't be picked.
import { Grid3x3, List, Map as MapIcon } from "@lucide/vue";
import { SegmentedControl } from "@tavora/official-ui";
import { ref } from "vue";

const withLabel = ref<"list" | "grid">("list");
const iconOnly = ref<"list" | "grid" | "map">("grid");
const locked = ref<"list" | "grid" | "map">("list");
</script>

<template>
  <div class="flex flex-wrap items-center gap-6" data-testid="segmented-icons">
    <div class="flex flex-col items-start gap-2">
      <span class="text-muted-foreground text-xs">Icon and label</span>
      <SegmentedControl
        v-model="withLabel"
        label="View"
        :options="[
          { value: 'list', label: 'List', icon: List },
          { value: 'grid', label: 'Grid', icon: Grid3x3 },
        ]"
      />
    </div>
    <div class="flex flex-col items-start gap-2">
      <span class="text-muted-foreground text-xs">Icon only</span>
      <SegmentedControl
        v-model="iconOnly"
        label="Layout"
        :options="[
          { value: 'list', label: 'List', icon: List, iconOnly: true },
          { value: 'grid', label: 'Grid', icon: Grid3x3, iconOnly: true, tooltip: 'Tiles of pictures' },
          { value: 'map', label: 'Map', icon: MapIcon, iconOnly: true },
        ]"
      />
    </div>
    <div class="flex flex-col items-start gap-2">
      <span class="text-muted-foreground text-xs">One option off</span>
      <SegmentedControl
        v-model="locked"
        label="Show as"
        :options="[
          { value: 'list', label: 'List', icon: List },
          { value: 'grid', label: 'Grid', icon: Grid3x3 },
          { value: 'map', label: 'Map', icon: MapIcon, disabled: true, disabledReason: 'Add a map first' },
        ]"
      />
    </div>
  </div>
</template>
