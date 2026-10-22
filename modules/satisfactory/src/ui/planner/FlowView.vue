<script setup lang="ts">
// The solved plan as a flow graph: a box per recipe row with its totals, boxes for what comes
// in and goes out, and an arrow with its rate for every item between them, left to right.
// Hovering or focusing a box lights up its arrows.
import { ZoomPane } from "@tavora/official-ui/components/ui/zoom-pane";
import { computed, ref } from "vue";
import type { PlanResult, Rate } from "../../contracts/plan";
import { language, locale, t } from "../../i18n";
import GameIcon from "../common/GameIcon.vue";
import { useModule, useNames } from "../context";
import { rateText } from "../describe";
import { type FlowKind, flowGraph, layoutFlow, type PlacedNode, type Point } from "../flowGraph";
import { formatClock, formatNumber, formatPower } from "../format";
import { itemTooltip } from "../tooltip";
import { showInCodex } from "./codexLink";
import RecipeLine from "./RecipeLine.vue";

const props = defineProps<{ result: PlanResult; targets: Rate[] }>();
const emit = defineEmits<{ chooseRecipe: [item: string, recipe: string] }>();

const context = useModule();
const { data } = context.services;
const vTip = context.tip;
const names = useNames(context);

/** Box and label sizes in pixels; the boxes are drawn at exactly these. */
const SIZES = { recipe: { width: 208, height: 116 }, end: { width: 200, height: 52 }, gap: 104 };
/** Length and half width of an arrowhead. */
const HEAD = 8;

const graph = computed(() => flowGraph(props.result, props.targets));
const layout = computed(() => layoutFlow(graph.value, SIZES));

/** The box under the pointer or holding focus; its arrows and neighbours stay lit. */
const active = ref<string | null>(null);
const lit = computed(() => {
  if (!active.value) return null;
  const nodes = new Set([active.value]);
  const edges = new Set<string>();
  for (const edge of graph.value.edges) {
    if (edge.from !== active.value && edge.to !== active.value) continue;
    edges.add(edge.id);
    nodes.add(edge.from);
    nodes.add(edge.to);
  }
  return { nodes, edges };
});
function leave(id: string) {
  if (active.value === id) active.value = null;
}

const rate = (item: string, perMinute: number) => rateText(data, item, perMinute, locale(), t);
const boxStyle = (placed: PlacedNode) => ({ left: `${placed.x}px`, top: `${placed.y}px`, width: `${placed.width}px`, height: `${placed.height}px` });

const END_LABEL: Record<Exclude<FlowKind, "recipe">, Parameters<typeof t>[0]> = {
  raw: "graph.raw",
  import: "graph.import",
  supplied: "graph.supplied",
  target: "graph.target",
  byproduct: "graph.byproduct",
  surplus: "graph.surplus",
};
const END_CLASS: Record<Exclude<FlowKind, "recipe">, string> = {
  raw: "bg-card",
  import: "bg-card",
  supplied: "bg-card",
  target: "bg-primary/10 border-primary/40",
  byproduct: "text-muted-foreground border-dashed",
  surplus: "text-muted-foreground border-dashed",
};

/** A smooth line through dagre's points, ending where the arrowhead starts. */
function linePath(points: Point[]): string {
  if (points.length < 2) return "";
  const end = headBase(points);
  const all = [...points.slice(0, -1), end];
  let path = `M ${all[0]!.x} ${all[0]!.y}`;
  for (let index = 1; index < all.length - 1; index++) {
    const point = all[index]!;
    const next = all[index + 1]!;
    path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
  }
  return `${path} L ${end.x} ${end.y}`;
}

function direction(points: Point[]) {
  const tip = points.at(-1)!;
  const before = points.at(-2)!;
  const length = Math.hypot(tip.x - before.x, tip.y - before.y) || 1;
  return { tip, dx: (tip.x - before.x) / length, dy: (tip.y - before.y) / length };
}

function headBase(points: Point[]): Point {
  const { tip, dx, dy } = direction(points);
  return { x: tip.x - dx * HEAD, y: tip.y - dy * HEAD };
}

function headPath(points: Point[]): string {
  if (points.length < 2) return "";
  const { tip, dx, dy } = direction(points);
  const base = headBase(points);
  const half = HEAD / 2;
  return `M ${tip.x} ${tip.y} L ${base.x - dy * half} ${base.y + dx * half} L ${base.x + dy * half} ${base.y - dx * half} Z`;
}

function machinesTip(placed: PlacedNode): string {
  const row = placed.node.row!;
  return t("results.machinesExact", { exact: formatNumber(row.machines, locale(), 4), rounded: row.machinesRounded });
}
</script>

<template>
  <ZoomPane class="h-[max(320px,calc(100vh-7rem))] rounded-none border-0" align="end" :fit-floor="0.6" :label="t('graph.label')" data-testid="flow">
    <div class="relative" :style="{ width: `${layout.width}px`, height: `${layout.height}px` }">
      <svg class="absolute inset-0 overflow-visible" :width="layout.width" :height="layout.height" aria-hidden="true">
        <g
          v-for="placed in layout.edges"
          :key="placed.edge.id"
          class="transition-opacity"
          :class="lit ? (lit.edges.has(placed.edge.id) ? 'text-primary' : 'text-muted-foreground opacity-20') : 'text-muted-foreground opacity-70'"
          data-testid="flow-edge"
        >
          <path :d="linePath(placed.points)" fill="none" stroke="currentColor" stroke-width="1.5" :stroke-dasharray="placed.back ? '6 4' : undefined" />
          <path :d="headPath(placed.points)" fill="currentColor" />
        </g>
      </svg>

      <!-- Rate labels sit on their arrows; the item's name shows on hover. -->
      <span
        v-for="placed in layout.edges"
        :key="`label|${placed.edge.id}`"
        v-tip="() => itemTooltip(data, placed.edge.item, language, locale(), t)"
        class="bg-background absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-md border px-1.5 text-xs whitespace-nowrap tabular-nums transition-opacity"
        :class="lit && !lit.edges.has(placed.edge.id) ? 'opacity-30' : undefined"
        :style="{ left: `${placed.label.x}px`, top: `${placed.label.y}px`, height: '22px' }"
        data-testid="flow-label"
      >
        <GameIcon :icon="data.items[placed.edge.item]?.icon" :size="14" />
        {{ rate(placed.edge.item, placed.edge.perMinute) }}
      </span>

      <div
        v-for="placed in layout.nodes"
        :key="placed.node.id"
        class="absolute overflow-hidden rounded-lg border text-sm transition-opacity"
        :class="[placed.node.kind === 'recipe' ? 'bg-card flex flex-col px-2.5 py-2' : ['flex items-center gap-2 px-2.5', END_CLASS[placed.node.kind]], lit && !lit.nodes.has(placed.node.id) && 'opacity-40']"
        :style="boxStyle(placed)"
        :data-kind="placed.node.kind"
        data-testid="flow-node"
        @pointerenter="active = placed.node.id"
        @pointerleave="leave(placed.node.id)"
        @focusin="active = placed.node.id"
        @focusout="leave(placed.node.id)"
      >
        <template v-if="placed.node.kind === 'recipe' && placed.node.row">
          <div class="flex min-w-0 items-center gap-2">
            <GameIcon :icon="data.items[placed.node.item]?.icon" :size="24" />
            <button
              v-tip="() => itemTooltip(data, placed.node.item, language, locale(), t)"
              type="button"
              class="hover:text-primary focus-visible:outline-ring flex min-w-0 gap-1 text-left leading-6 font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
              :aria-label="t('results.showInCodex', { item: names.item(placed.node.item) })"
              @click="showInCodex(context, `item:${placed.node.item}`, names.item(placed.node.item))"
            >
              <!-- Only the name shortens, so the rate always shows. -->
              <span class="min-w-0 truncate">{{ names.item(placed.node.item) }}</span>
              <span class="text-muted-foreground flex-none font-normal tabular-nums">· {{ rate(placed.node.item, placed.node.perMinute) }}</span>
            </button>
          </div>
          <RecipeLine :row="placed.node.row" @choose-recipe="(item, recipe) => emit('chooseRecipe', item, recipe)" />
          <div class="mt-auto flex min-w-0 items-center gap-1.5 text-xs leading-5" :title="machinesTip(placed)">
            <GameIcon :icon="data.buildings[placed.node.row.building]?.icon" kind="building" :size="16" />
            <span class="min-w-0 truncate font-medium tabular-nums">{{ t("graph.machines", { count: placed.node.row.machinesRounded, building: names.building(placed.node.row.building) }) }}</span>
          </div>
          <p class="text-muted-foreground truncate text-xs leading-5 tabular-nums">
            {{ formatClock(placed.node.row.clockPercent, locale()) }} · {{ formatPower(placed.node.row.powerMW, locale()) }}
          </p>
        </template>
        <template v-else-if="placed.node.kind !== 'recipe'">
          <!-- A target gets the gold accent bar, as in the chain. -->
          <span v-if="placed.node.kind === 'target'" aria-hidden="true" class="bg-primary absolute inset-y-0 left-0 w-1" />
          <GameIcon :icon="data.items[placed.node.item]?.icon" :size="24" />
          <div class="min-w-0 flex-1">
            <button
              v-tip="() => itemTooltip(data, placed.node.item, language, locale(), t)"
              type="button"
              class="hover:text-primary focus-visible:outline-ring block max-w-full truncate text-left leading-5 font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
              :aria-label="t('results.showInCodex', { item: names.item(placed.node.item) })"
              @click="showInCodex(context, `item:${placed.node.item}`, names.item(placed.node.item))"
            >
              {{ names.item(placed.node.item) }}
            </button>
            <p class="text-muted-foreground flex gap-1 text-xs leading-5 tabular-nums">
              <span class="min-w-0 truncate">{{ t(END_LABEL[placed.node.kind]) }}</span>
              <span class="flex-none">· {{ rate(placed.node.item, placed.node.perMinute) }}</span>
            </p>
          </div>
        </template>
      </div>
    </div>
  </ZoomPane>
</template>
