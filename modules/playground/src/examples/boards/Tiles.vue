<script setup lang="ts">
// Tiles that wrap to the panel's width: `columns: "auto"` reads the row from the page, so ↑ and ↓ follow it at any
// width. `select: "none"`: the arrows only move the focus, Enter places the tile.
import { useSlotGrid } from "@tavora/official-ui";
import { computed, ref } from "vue";
import { t } from "../../i18n";

const tilesLabel = computed(() => t("demo.tiles"));

const TILES = ["🌲", "🌾", "🪨", "🌊", "🏠", "⛏️", "🐑", "🌻", "🍄", "🔥", "🌙", "⭐"];
const placed = ref<string[]>([]);
const grid = useSlotGrid({ slots: TILES, columns: "auto", select: "none" });
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-bind="grid.root" :aria-label="tilesLabel" class="flex max-w-72 flex-wrap gap-1.5">
      <div
        v-for="tile in TILES"
        :key="tile"
        v-bind="grid.slot(tile)"
        role="button"
        class="bg-card flex size-10 cursor-pointer items-center justify-center rounded-md border text-lg"
        @click="placed = [...placed, tile].slice(-8)"
      >
        {{ tile }}
      </div>
    </div>
    <span class="text-muted-foreground min-h-5 text-sm">{{ placed.join(" ") || t("demo.tilesNone") }}</span>
  </div>
</template>
