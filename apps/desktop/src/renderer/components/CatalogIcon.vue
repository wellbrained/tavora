<script setup lang="ts">
// A catalog module's icon on its card and page. The main process fetches it by its listed hash and
// checks it is a small PNG or WebP (C10, like G10); until then, or without one, a puzzle piece.
import { Puzzle } from "@lucide/vue";
import { ref, watch } from "vue";
import { api } from "../host";

const props = withDefaults(defineProps<{ moduleId: string; has: boolean; size?: string }>(), { size: "size-12" });
const url = ref<string | null>(null);

watch(
  () => [props.moduleId, props.has] as const,
  async ([id, has]) => {
    url.value = null;
    if (!has) return;
    const icon = await api.catalogIcon(id);
    if (id === props.moduleId) url.value = icon;
  },
  { immediate: true },
);
</script>

<template>
  <span :class="[size, 'bg-muted/60 grid flex-none place-items-center overflow-hidden rounded-xl']" aria-hidden="true">
    <img v-if="url" :src="url" alt="" class="size-full object-cover" draggable="false" data-testid="catalog-icon" />
    <Puzzle v-else class="text-muted-foreground size-1/2" :stroke-width="1.5" />
  </span>
</template>
