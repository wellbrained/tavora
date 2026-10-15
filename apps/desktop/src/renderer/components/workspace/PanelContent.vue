<script setup lang="ts">
// Stands where a module panel's native view is drawn. The view covers it,
// so this only shows while the view is hidden: a still image of the module
// during menus and drags, or the module's name and state. A Browser panel
// also gets its toolbar here, above the page, and its start and error pages.
import type { IDockviewPanelProps } from "dockview-vue";
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { act, frozen, state } from "../../host";
import BrowserToolbar from "./BrowserToolbar.vue";
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
  <div class="flex size-full flex-col">
  <BrowserToolbar v-if="panel?.browser" :instance-id="id" :browser="panel.browser" />
  <div ref="element" class="relative min-h-0 w-full flex-1 overflow-hidden" :data-testid="`panel-content-${id}`">
    <img
      v-if="image"
      :src="image"
      alt=""
      class="absolute top-0 left-0 max-w-none"
      :style="imageSize ? { width: `${imageSize.width}px`, height: `${imageSize.height}px` } : { width: '100%', height: '100%' }"
      draggable="false"
      @load="onImageLoad"
    />
    <div v-else-if="panel?.browser?.error" class="flex size-full flex-col items-center justify-center gap-3 p-4 text-center" :data-testid="`browser-error-${id}`">
      <p class="font-medium">{{ panel.browser.error }}</p>
      <p class="text-muted-foreground max-w-sm truncate text-sm">{{ panel.browser.host }}</p>
      <Button variant="outline" size="sm" @click="act({ type: 'browser-command', instanceId: id, command: 'reload' })">Try again</Button>
    </div>
    <div v-else-if="panel?.browser && !panel.browser.url" class="text-muted-foreground flex size-full flex-col items-center justify-center gap-1 p-4 text-center text-sm">
      <p class="text-foreground font-medium">Search or type an address above</p>
      <p>Sign-ins stay with this game unless you share a site for all games. Ads are blocked and files are never downloaded.</p>
    </div>
    <div v-else class="text-muted-foreground flex size-full items-center justify-center p-4 text-center">
      {{ panel?.name }}
    </div>
  </div>
  </div>
</template>
