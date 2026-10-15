<script setup lang="ts">
// Stands where a module panel's native view is drawn. The view covers it,
// so this only shows while the view is hidden: a still image of the module
// during menus and drags, or the module's name and state.
import type { IDockviewPanelProps } from "dockview-vue";
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { frozen, state } from "../../host";
import { DOCK } from "./dock-context";

const props = defineProps<{ params: IDockviewPanelProps }>();
const dock = inject(DOCK)!;
const id = props.params.api.id;
const element = ref<HTMLElement | null>(null);
const panel = computed(() => state.value?.panels.find((item) => item.instanceId === id));
const image = computed(() => frozen.value[id]);

// The still image is shown at the size it was taken (its pixels over the
// screen's pixel ratio), so resizing a split crops or reveals it instead of
// stretching it.
const imageSize = ref<{ width: number; height: number } | null>(null);
function onImageLoad(event: Event) {
  const img = event.target as HTMLImageElement;
  imageSize.value = { width: img.naturalWidth / devicePixelRatio, height: img.naturalHeight / devicePixelRatio };
}
watch(image, () => (imageSize.value = null));

onMounted(() => dock.register(id, element.value!));
onBeforeUnmount(() => dock.unregister(id, element.value!));
</script>

<template>
  <div ref="element" class="relative size-full overflow-hidden" :data-testid="`panel-content-${id}`">
    <img
      v-if="image"
      :src="image"
      alt=""
      class="absolute top-0 left-0 max-w-none"
      :style="imageSize ? { width: `${imageSize.width}px`, height: `${imageSize.height}px` } : { width: '100%', height: '100%' }"
      draggable="false"
      @load="onImageLoad"
    />
    <div v-else class="text-muted-foreground flex size-full items-center justify-center p-4 text-center">
      {{ panel?.name }}
    </div>
  </div>
</template>
