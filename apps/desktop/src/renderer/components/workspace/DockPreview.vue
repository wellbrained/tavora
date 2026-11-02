<script setup lang="ts">
// What a drag shows while nothing moves: faint strips along the dock's edges, a dashed outline where a new column or
// row would land, an outline around the group that takes a tab (with a dashed tab in its strip), or, when the room is
// too small, a note that says so. The lifted group fades and the tabs make room in dock.css. The numbers come from the
// layout model (dock-model.ts) through dock-preview.ts.
import { computed } from "vue";
import { cn } from "@tavora/official-ui/lib/utils";
import { t } from "../../i18n";
import type { PreviewView } from "../../dock-preview";
import type { Rect, Side } from "../../dock-model";

const props = defineProps<{ preview: PreviewView }>();

const SIDES: Side[] = ["left", "right", "top", "bottom"];
const STRIP = 6;

const target = computed(() => props.preview.target);
const plan = computed(() => props.preview.plan);
/** The reason a drop is refused for lack of room; a drop that changes nothing shows nothing. */
const refused = computed(() => (plan.value && !plan.value.ok && plan.value.reason === "too-small" ? t("dock.noRoom") : null));

const at = (rect: Rect, grow = 0) => ({
  left: `${props.preview.origin.x + rect.x - grow}px`,
  top: `${props.preview.origin.y + rect.y - grow}px`,
  width: `${rect.width + 2 * grow}px`,
  height: `${rect.height + 2 * grow}px`,
});

const strip = (side: Side) => {
  const { origin, width, height } = props.preview;
  const horizontal = side === "left" || side === "right";
  return {
    left: `${origin.x + (side === "right" ? width - STRIP : 0)}px`,
    top: `${origin.y + (side === "bottom" ? height - STRIP : 0)}px`,
    width: `${horizontal ? STRIP : width}px`,
    height: `${horizontal ? height : STRIP}px`,
  };
};
const lit = (side: Side) => target.value?.kind === "edge" && target.value.side === side;

/** The rectangle the dragged panel will have: from the model, for a new column or row. */
const landing = computed(() => {
  const value = plan.value;
  const aim = target.value;
  if (!value?.ok || !aim || aim.kind === "tab") return null;
  const side = aim.side;
  return { rect: value.landing, label: side === "left" || side === "right" ? t("dock.newColumn") : t("dock.newRow") };
});

/** The group that takes the drop as a tab. */
const tabGroup = computed(() => {
  const aim = target.value;
  return plan.value?.ok && aim?.kind === "tab" ? props.preview.rects[aim.group] : null;
});

/** A drop that would change nothing: the move cursor stays, and a small label says why nothing happens. */
const samePlace = computed<Rect | null>(() => {
  const aim = target.value;
  if (!aim || aim.kind === "edge" || !plan.value || plan.value.ok || plan.value.reason !== "same-spot") return null;
  return props.preview.rects[aim.group] ?? null;
});

/** Where a refused drop is pointed: the group, or the strip of the dock's edge. */
const refusedRect = computed<Rect | null>(() => {
  const aim = target.value;
  if (!refused.value || !aim) return null;
  if (aim.kind === "edge") {
    const { width, height } = props.preview;
    return aim.side === "left" ? { x: 0, y: 0, width: STRIP * 3, height } : aim.side === "right" ? { x: width - STRIP * 3, y: 0, width: STRIP * 3, height } : aim.side === "top" ? { x: 0, y: 0, width, height: STRIP * 3 } : { x: 0, y: height - STRIP * 3, width, height: STRIP * 3 };
  }
  return props.preview.rects[aim.group] ?? null;
});
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-[45]" data-testid="dock-preview" :data-target="target ? (target.kind === 'edge' ? `edge-${target.side}` : target.kind === 'tab' ? 'tab' : `split-${target.side}`) : undefined" :data-refused="refused ? 'true' : undefined" :data-reason="plan && !plan.ok ? plan.reason : undefined" aria-hidden="true">
    <!-- The dock's outer edges: faint while you drag, lit when aimed at. -->
    <div
      v-for="side in SIDES"
      :key="side"
      :class="cn('dock-fade bg-primary-fill absolute rounded-full', lit(side) ? (refused ? 'bg-destructive opacity-100' : 'opacity-100') : 'opacity-20')"
      :style="strip(side)"
      :data-testid="`dock-edge-${side}`"
      :data-lit="lit(side) ? 'true' : undefined"
    />

    <!-- A new column or row: a dashed outline, exactly where the panel lands. -->
    <Transition name="dock-fade">
      <div v-if="landing" key="landing" class="border-primary bg-primary/10 absolute flex items-center justify-center rounded-[10px] border-2 border-dashed" :style="at(landing.rect)" data-testid="dock-landing">
        <span class="bg-primary-fill text-primary-fill-foreground rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap">{{ landing.label }}</span>
      </div>
    </Transition>

    <!-- A tab: the group gets a clear outline and a dashed tab where the panel will sit. -->
    <Transition name="dock-fade">
      <div v-if="tabGroup" key="tab" class="border-primary absolute rounded-[10px] border-[3px] shadow-[0_0_24px_2px_color-mix(in_srgb,var(--primary)_40%,transparent)]" :style="at(tabGroup, 1)" data-testid="dock-tab-outline" />
    </Transition>
    <div
      v-if="preview.ghost && tabGroup"
      :class="cn('absolute flex items-center rounded-lg text-[13px] font-medium', preview.bar ? 'bg-primary-fill shadow-[0_0_0_2px_var(--background)]' : 'border-primary bg-primary/15 text-foreground border border-dashed px-3')"
      :style="at(preview.ghost)"
      data-testid="dock-ghost-tab"
    >
      <span v-if="!preview.bar" class="truncate">{{ preview.title }}</span>
    </div>

    <Transition name="dock-fade">
      <div v-if="samePlace" key="same" class="absolute flex items-center justify-center" :style="at(samePlace)" data-testid="dock-same-place">
        <span class="bg-card text-foreground rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap shadow-sm">{{ t("dock.samePlace") }}</span>
      </div>
    </Transition>

    <!-- Too little room: no outline, and the reason. -->
    <Transition name="dock-fade">
      <div v-if="refusedRect" key="refused" class="border-destructive/70 bg-destructive/5 absolute flex items-center justify-center rounded-[10px] border-2 border-dashed" :style="at(refusedRect)" data-testid="dock-refused">
        <span class="bg-destructive text-background rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap">{{ refused }}</span>
      </div>
    </Transition>
  </div>
</template>
