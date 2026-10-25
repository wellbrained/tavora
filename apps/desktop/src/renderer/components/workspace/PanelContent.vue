<script setup lang="ts">
// Stands where a module panel's native view is drawn. The view covers it,
// so this only shows while the view is hidden: a still image of the module
// during menus and drags, or the module's name and state. A Browser panel
// also gets its toolbar here, above the page, and its start and error pages.
// A module whose update asks for more gets a bar above its view to review it, and so does one whose
// catalog update waits for the player's yes because it asks for more (the panel keeps running the
// installed version until then).
// A panel that is over the game right now (the in-game layer is open) leaves a quiet note in its slot (game-overlay-window.ts).
// A panel whose type the module no longer offers says so, with Remove and the
// module's other panel types (the decision log, named panels round 4).
import type { IDockviewPanelProps } from "dockview-vue";
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ShieldAlert } from "@lucide/vue";
import { act, dialog, frozen, needsGrant, state } from "../../host";
import { t } from "../../i18n";
import BrowserToolbar from "./BrowserToolbar.vue";
import CampfireLoader from "./CampfireLoader.vue";
import { DOCK } from "./dock-context";

const props = defineProps<{ params: IDockviewPanelProps }>();
const dock = inject(DOCK)!;
const id = props.params.api.id;
const element = ref<HTMLElement | null>(null);
const panel = computed(() => state.value?.panels.find((item) => item.instanceId === id));
const image = computed(() => frozen.value[id]);
const module = computed(() => state.value?.modules.find((item) => item.id === panel.value?.moduleId));
/** The module's update asks for something not granted yet (or its grant was lost): the bar offers to review it. */
const reviewNeeded = computed(() => {
  const module = state.value?.modules.find((item) => item.id === panel.value?.moduleId);
  return module !== undefined && needsGrant(module);
});
const updateWaiting = computed(() => module.value?.update ?? null);

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
    v-if="panel && updateWaiting"
    class="bg-info/10 flex flex-none items-center gap-2 border-b px-3 py-1.5 text-sm"
    role="status"
    :data-testid="`update-review-${id}`"
  >
    <ShieldAlert :stroke-width="1.5" class="text-info size-4 flex-none" aria-hidden="true" />
    <span class="min-w-0 flex-1 truncate">{{ t("grant.updateBar", { name: panel.name, version: updateWaiting.version }) }}</span>
    <Button
      size="sm"
      variant="outline"
      class="h-7"
      :data-testid="`update-review-open-${id}`"
      @click="dialog = { kind: 'grant', moduleId: panel.moduleId, slot: null, review: true, update: true }"
    >
      {{ t("grant.review") }}
    </Button>
  </div>
  <div
    v-else-if="panel && reviewNeeded"
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
    <div
      v-if="panel?.overGame"
      class="text-muted-foreground flex size-full flex-col items-center justify-center gap-3 p-4 text-center text-sm"
      :data-testid="`panel-over-game-${id}`"
    >
      <p>{{ t("panel.overGame") }}</p>
    </div>
    <img
      v-else-if="image"
      :src="image"
      alt=""
      class="absolute top-0 left-0 max-w-none"
      :style="imageSize ? { width: `${imageSize.width}px`, height: `${imageSize.height}px` } : { width: '100%', height: '100%' }"
      draggable="false"
      @load="onImageLoad"
    />
    <div
      v-else-if="panel?.status === 'unavailable'"
      class="flex size-full flex-col items-center justify-center gap-3 overflow-y-auto p-4 text-center"
      :data-testid="`panel-type-gone-${id}`"
    >
      <p v-if="!module" class="max-w-sm text-sm" :data-testid="`panel-module-waiting-${id}`">{{ t("panel.moduleWaiting", { module: panel.name }) }}</p>
      <p v-else class="max-w-sm text-sm">{{ t("panel.typeGone", { module: module.name, type: panel.name }) }}</p>
      <template v-if="module?.panels.length">
        <p class="text-muted-foreground text-sm">{{ t("panel.typeGoneChoose", { module: module.name }) }}</p>
        <div class="flex max-w-md flex-wrap justify-center gap-2">
          <Button
            v-for="type in module.panels"
            :key="type.id"
            size="sm"
            variant="outline"
            :data-testid="`choose-panel-type-${type.id}`"
            @click="act({ type: 'choose-panel-type', instanceId: id, panelType: type.id })"
          >
            {{ type.name }}
          </Button>
        </div>
      </template>
      <Button size="sm" variant="danger" data-testid="remove-unavailable-panel" @click="act({ type: 'close-panel', instanceId: id })">{{ t("panel.remove") }}</Button>
    </div>
    <div v-else-if="panel?.browser?.error" class="flex size-full flex-col items-center justify-center gap-3 p-4 text-center" :data-testid="`browser-error-${id}`">
      <p class="font-medium">{{ t(`browser.error.${panel.browser.error.kind}`, { detail: panel.browser.error.detail }) }}</p>
      <p class="text-muted-foreground max-w-sm truncate text-sm">{{ panel.browser.host }}</p>
      <Button variant="outline" size="sm" @click="act({ type: 'browser-command', instanceId: id, command: 'reload' })">{{ t("browser.tryAgain") }}</Button>
    </div>
    <div v-else-if="panel?.browser && !panel.browser.url" class="text-muted-foreground flex size-full flex-col items-center justify-center gap-1 p-4 text-center text-sm">
      <p class="text-foreground font-medium">{{ t("browser.startTitle") }}</p>
      <p>{{ t("browser.startText") }}</p>
    </div>
    <CampfireLoader v-else-if="panel?.waiting" :name="panel.name" :data-testid="`panel-loading-${id}`" />
    <div v-else class="text-muted-foreground flex size-full items-center justify-center p-4 text-center">
      {{ panel?.name }}
    </div>
  </div>
  </div>
</template>
