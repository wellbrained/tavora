<script setup lang="ts">
// The small toolbar next to the selected frame on the canvas: Settings, Hide on canvas (the eye of the Sources list), Reset
// position, Reset size, and Remove after a thin divider. It lives in the layer over the canvas, which takes the mouse;
// LayoutCanvas.vue decides where it sits. Each button has a kit tooltip that opens on the side away from the frame, so it
// never covers what you are arranging.
import { Eye, EyeOff, LocateFixed, Scaling, Settings, Trash2 } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, type Component } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Separator } from "@tavora/official-ui/components/ui/separator";
import { Tooltip } from "@tavora/official-ui/components/tooltip";
import type { LayoutItemView } from "../../../shared/layout-view";
import { t } from "../../i18n";
import { send } from "./layout-state";

/** `side`: where the toolbar sits next to the frame, so its tooltips open the other way. */
const props = defineProps<{ item: LayoutItemView; side: "top" | "bottom" }>();
const emit = defineEmits<{ done: [] }>();

interface Action {
  id: "settings" | "hide" | "reset" | "reset-size" | "remove";
  icon: Component;
  label: string;
  run: () => void;
}

const actions = computed<Action[]>(() => {
  const { id, hiddenOnCanvas } = props.item;
  return [
    { id: "settings", icon: Settings, label: t("overlays.layout.settings"), run: () => send({ type: "settings", id }) },
    { id: "hide", icon: hiddenOnCanvas ? EyeOff : Eye, label: hiddenOnCanvas ? t("overlays.layout.showOnCanvas") : t("overlays.layout.hideOnCanvas"), run: () => send({ type: "canvas-hidden", id, hidden: !hiddenOnCanvas }) },
    { id: "reset", icon: LocateFixed, label: t("overlays.layout.reset"), run: () => send({ type: "reset", id }) },
    { id: "reset-size", icon: Scaling, label: t("overlays.layout.resetSize"), run: () => send({ type: "reset-size", id }) },
    { id: "remove", icon: Trash2, label: t("overlays.remove"), run: () => send({ type: "remove", id }) },
  ];
});

const tip = ref<{ text: string; anchor: { left: number; top: number; right: number; bottom: number } } | null>(null);
let delay: ReturnType<typeof setTimeout> | undefined;

function show(event: Event, label: string) {
  const button = event.currentTarget as HTMLElement;
  clearTimeout(delay);
  delay = setTimeout(() => {
    const { left, top, right, bottom } = button.getBoundingClientRect();
    tip.value = { text: label, anchor: { left, top, right, bottom } };
  }, 150);
}

function hide() {
  clearTimeout(delay);
  tip.value = null;
}

function press(action: Action) {
  hide();
  action.run();
  // The layer keeps the keyboard (Del, the arrow keys) once a button was used.
  emit("done");
}

onBeforeUnmount(() => clearTimeout(delay));
</script>

<template>
  <div
    class="bg-popover text-popover-foreground absolute z-10 flex items-center gap-1 rounded-md border p-1 shadow-md"
    role="toolbar"
    :aria-label="t('overlays.layout.itemTools')"
    data-testid="layout-frame-toolbar"
    @pointerdown.stop
  >
    <template v-for="action in actions" :key="action.id">
      <!-- A thin line sets Remove apart from the ones that only change the frame. -->
      <Separator v-if="action.id === 'remove'" orientation="vertical" class="mx-0.5 h-5" />
      <Button
        variant="ghost"
        size="icon-sm"
        :class="action.id === 'remove' && 'text-destructive hover:text-destructive'"
        :aria-label="action.label"
        :data-testid="`layout-frame-${action.id}`"
        @pointerenter="show($event, action.label)"
        @pointerleave="hide"
        @focus="($event.target as HTMLElement).matches(':focus-visible') && show($event, action.label)"
        @blur="hide"
        @click="press(action)"
      >
        <component :is="action.icon" :stroke-width="1.5" />
      </Button>
    </template>
    <!-- Drawn on the page, not inside the toolbar, so the layer's edge can't clip it. -->
    <Tooltip :open="tip !== null" :anchor="tip?.anchor" :side="side" compact :description="tip?.text" @dismiss="hide" />
  </div>
</template>
