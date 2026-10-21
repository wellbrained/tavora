<script setup lang="ts">
// An item's or building's small picture, shipped next to the page. Without
// one, or when it fails to load, a neutral outline glyph stands in.
import { Box, Factory } from "@lucide/vue";
import { ref, watch } from "vue";

/** Pictures that failed once are not tried again in this page. */
const failed = new Set<string>();

const props = withDefaults(defineProps<{ icon?: string | undefined; kind?: "item" | "building"; size?: number }>(), { kind: "item", size: 20 });

const broken = ref(!props.icon || failed.has(props.icon));
watch(
  () => props.icon,
  (icon) => (broken.value = !icon || failed.has(icon)),
);

function onError() {
  if (props.icon) failed.add(props.icon);
  broken.value = true;
}
</script>

<template>
  <span class="inline-flex flex-none items-center justify-center" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true">
    <img v-if="!broken" :src="icon" alt="" class="size-full object-contain" loading="lazy" draggable="false" @error="onError" />
    <span v-else class="bg-muted text-muted-foreground inline-flex size-full items-center justify-center rounded-sm">
      <Factory v-if="kind === 'building'" :size="Math.round(size * 0.65)" :stroke-width="1.5" />
      <Box v-else :size="Math.round(size * 0.65)" :stroke-width="1.5" />
    </span>
  </span>
</template>
