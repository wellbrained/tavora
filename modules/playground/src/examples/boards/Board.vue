<script setup lang="ts">
// A 5 × 5 board: one Tab stop, the arrows move and pick, Home and End go along the row, Ctrl+Home and Ctrl+End to the
// corners. Two slots are locked (reached, not picked), one place is a hole. Delete clears the slot the keyboard is on:
// that key is the page's own, on the board's keydown.
import { useSlotGrid } from "@tavora/official-ui";
import { Castle, Lock, Plus, Shield, Sword, TowerControl } from "@lucide/vue";
import { computed, ref, type Component } from "vue";
import { t } from "../../i18n";

const boardLabel = computed(() => t("demo.board"));

const pieces = ref<Record<string, Component>>({ a1: Sword, a3: TowerControl, b2: Shield, c3: Castle, d1: TowerControl, e4: Shield });
const LOCKED = new Set(["a5", "e3"]);
const slots = ["a", "b", "c", "d", "e"].flatMap((row) => [1, 2, 3, 4, 5].map((col) => (row === "b" && col === 4 ? null : `${row}${col}`)));
const selected = ref<string | null>("c3");

const grid = useSlotGrid({ slots, columns: 5, selected, disabled: (key) => (LOCKED.has(key) ? t("demo.slotLocked") : false) });

function onKeydown(event: KeyboardEvent) {
  const key = grid.focused.value;
  if ((event.key === "Delete" || event.key === "Backspace") && key && pieces.value[key]) {
    const { [key]: _, ...rest } = pieces.value;
    pieces.value = rest;
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-bind="grid.root" :aria-label="boardLabel" class="grid w-max grid-cols-5 gap-1.5" @keydown="onKeydown">
      <template v-for="(key, index) in slots" :key="key ?? `hole-${index}`">
        <span v-if="!key" class="size-10" />
        <div
          v-else
          v-bind="grid.slot(key)"
          :aria-label="key"
          :class="['bg-card flex size-10 items-center justify-center rounded-md border', !pieces[key] && !LOCKED.has(key) && 'text-muted-foreground border-dashed bg-transparent']"
        >
          <Lock v-if="LOCKED.has(key)" class="size-4" aria-hidden="true" />
          <component :is="pieces[key]" v-else-if="pieces[key]" class="size-4.5" aria-hidden="true" />
          <Plus v-else class="size-4" aria-hidden="true" />
        </div>
      </template>
    </div>
    <span class="text-muted-foreground text-xs tabular-nums">{{ t("demo.slotPicked", { slot: selected ?? "–" }) }}</span>
  </div>
</template>
