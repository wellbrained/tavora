<script setup lang="ts">
// A catalog module's icon on its card and page. The main process fetches it by its listed hash and
// checks it is a small PNG or WebP (C10, like G10). The box is there from the start and the icon fades in once it has
// loaded; without one, or when it fails, a puzzle piece.
import { Puzzle } from "@lucide/vue";
import { ref, watch } from "vue";
import { FadeImage } from "@tavora/official-ui/components/ui/fade-image";
import { useTask } from "@tavora/official-ui/use-task";
import { api } from "../host";

const props = withDefaults(defineProps<{ moduleId: string; has: boolean; size?: string }>(), { size: "size-12" });
const url = ref<string | null>(null);
/** The icon is being fetched; a fetch that fails ends as `failed` and shows the puzzle piece (no message, no retry). */
const fetcher = useTask({ mode: "latest" });
const fetching = fetcher.busy;

watch(
  () => [props.moduleId, props.has] as const,
  async ([id, has]) => {
    url.value = null;
    if (!has) return fetcher.reset();
    const icon = await fetcher.run(() => api.catalogIcon(id));
    if (icon !== undefined) url.value = icon;
  },
  { immediate: true },
);
</script>

<template>
  <span class="contents" data-testid="catalog-icon-box" :data-status="fetcher.state.value.status">
  <FadeImage :src="url" :pending="fetching" :class="[size, 'flex-none rounded-xl']" alt="" draggable="false" data-testid="catalog-icon" aria-hidden="true">
    <template #fallback><Puzzle class="text-muted-foreground size-1/2" :stroke-width="1.5" /></template>
  </FadeImage>
  </span>
</template>
