<script setup lang="ts">
// Stands where a module panel's native view is drawn. The view covers it,
// so this only shows while the view is hidden: a still image of the module
// during menus and drags, or the module's name and state. A Browser panel
// also gets its toolbar here, above the page, and its start and error pages.
// Discord and AI usage panels have no native view: they are drawn here in full.
// A module whose update asks for more gets a bar above its view to review it.
import type { IDockviewPanelProps } from "dockview-vue";
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "@lucide/vue";
import { act, dialog, frozen, needsGrant, state } from "../../host";
import { t } from "../../i18n";
import BrowserToolbar from "./BrowserToolbar.vue";
import AiUsagePanel from "./AiUsagePanel.vue";
import DiscordPanel from "./DiscordPanel.vue";
import { DOCK } from "./dock-context";

const props = defineProps<{ params: IDockviewPanelProps }>();
const dock = inject(DOCK)!;
const id = props.params.api.id;
const element = ref<HTMLElement | null>(null);
const panel = computed(() => state.value?.panels.find((item) => item.instanceId === id));
const image = computed(() => frozen.value[id]);
/** The module's update asks for something not granted yet (or its grant was lost): the bar offers to review it. */
const reviewNeeded = computed(() => {
  const module = state.value?.modules.find((item) => item.id === panel.value?.moduleId);
  return module !== undefined && needsGrant(module);
});

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
  <div
    v-if="panel && reviewNeeded"
    class="bg-warning/10 flex flex-none items-center gap-2 border-b px-3 py-1.5 text-sm"
    role="status"
    :data-testid="`grant-review-${id}`"
  >
    <ShieldAlert :stroke-width="1.5" class="text-warning size-4 flex-none" aria-hidden="true" />
    <span class="min-w-0 flex-1 truncate">{{ t("grant.reviewBar", { name: panel.name }) }}</span>
    <Button size="sm" variant="outline" class="h-7" :data-testid="`grant-review-open-${id}`" @click="dialog = { kind: 'grant', moduleId: panel.moduleId, slot: null, review: true }">
      {{ t("grant.review") }}
    </Button>
  </div>
  <div ref="element" class="relative min-h-0 w-full flex-1 overflow-hidden" :data-testid="`panel-content-${id}`">
    <DiscordPanel v-if="panel?.moduleId === 'tavora.discord'" />
    <AiUsagePanel v-else-if="panel?.moduleId === 'tavora.ai-usage'" />
    <img
      v-else-if="image"
      :src="image"
      alt=""
      class="absolute top-0 left-0 max-w-none"
      :style="imageSize ? { width: `${imageSize.width}px`, height: `${imageSize.height}px` } : { width: '100%', height: '100%' }"
      draggable="false"
      @load="onImageLoad"
    />
    <div v-else-if="panel?.browser?.error" class="flex size-full flex-col items-center justify-center gap-3 p-4 text-center" :data-testid="`browser-error-${id}`">
      <p class="font-medium">{{ t(`browser.error.${panel.browser.error.kind}`, { detail: panel.browser.error.detail }) }}</p>
      <p class="text-muted-foreground max-w-sm truncate text-sm">{{ panel.browser.host }}</p>
      <Button variant="outline" size="sm" @click="act({ type: 'browser-command', instanceId: id, command: 'reload' })">{{ t("browser.tryAgain") }}</Button>
    </div>
    <div v-else-if="panel?.browser && !panel.browser.url" class="text-muted-foreground flex size-full flex-col items-center justify-center gap-1 p-4 text-center text-sm">
      <p class="text-foreground font-medium">{{ t("browser.startTitle") }}</p>
      <p>{{ t("browser.startText") }}</p>
    </div>
    <div v-else class="text-muted-foreground flex size-full items-center justify-center p-4 text-center">
      {{ panel?.name }}
    </div>
  </div>
  </div>
</template>
