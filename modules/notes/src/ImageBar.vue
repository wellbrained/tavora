<script setup lang="ts">
// The bar above a selected picture: inline with the text or on its own line at a chosen width,
// larger view, remove. Dragging the corner of a picture on its own line resizes it freely.
import { Maximize2, Trash2 } from "@lucide/vue";
import { cn } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { computed } from "vue";
import { t } from "./i18n";
import type { ImageMode } from "./ImageNode";

const props = defineProps<{ mode: ImageMode; width: number | null; left: number; top: number }>();
const emit = defineEmits<{ set: [patch: { mode: ImageMode; width: number | null }]; open: []; remove: [] }>();

/** The sizes on offer; a width dragged by hand matches none of them. */
const choices = computed(() => [
  { id: "inline", label: t("image.inline"), active: props.mode === "inline", patch: { mode: "inline" as const, width: null } },
  { id: "small", label: t("image.small"), active: props.mode === "block" && props.width === 25, patch: { mode: "block" as const, width: 25 } },
  { id: "medium", label: t("image.medium"), active: props.mode === "block" && props.width === 50, patch: { mode: "block" as const, width: 50 } },
  { id: "full", label: t("image.full"), active: props.mode === "block" && props.width === null, patch: { mode: "block" as const, width: null } },
]);

/** Keeps the bar inside the panel. */
const style = computed(() => ({ left: `${Math.max(8, Math.min(props.left, window.innerWidth - 330))}px`, top: `${Math.max(8, props.top)}px` }));
</script>

<template>
  <div
    class="bg-popover text-popover-foreground fixed z-50 flex items-center gap-0.5 rounded-md border p-1 text-xs shadow-lg"
    :style="style"
    role="toolbar"
    :aria-label="t('image.bar')"
    data-image-bar
    data-testid="image-bar"
    @pointerdown.prevent
  >
    <Button
      v-for="choice in choices"
      :key="choice.id"
      variant="ghost"
      size="sm"
      :class="cn('h-7 flex-none px-2 text-xs', choice.active && 'bg-accent text-foreground')"
      :aria-pressed="choice.active"
      :data-testid="`image-${choice.id}`"
      @click="emit('set', choice.patch)"
    >
      {{ choice.label }}
    </Button>
    <span class="bg-border mx-1 h-4 w-px flex-none" aria-hidden="true" />
    <Button variant="ghost" size="icon-sm" class="flex-none" data-testid="image-open" :aria-label="t('image.openLarger')" :title="t('image.openLarger')" @click="emit('open')">
      <Maximize2 :stroke-width="1.5" />
    </Button>
    <Button variant="ghost" size="icon-sm" class="flex-none" data-testid="image-remove" :aria-label="t('image.remove')" :title="t('image.remove')" @click="emit('remove')">
      <Trash2 :stroke-width="1.5" />
    </Button>
  </div>
</template>
