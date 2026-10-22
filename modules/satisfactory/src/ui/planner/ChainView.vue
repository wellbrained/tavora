<script setup lang="ts">
// The solved plan as a production chain: each target a tree down to the raw resources,
// a shared item under every parent with that parent's share.
import { ChevronDown, ChevronRight } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { computed, reactive } from "vue";
import type { PlanResult, Rate } from "../../contracts/plan";
import { language, locale, t } from "../../i18n";
import { type ChainNode, type ChainPart, productionChain } from "../chain";
import GameIcon from "../common/GameIcon.vue";
import { useModule, useNames } from "../context";
import { rateText } from "../describe";
import { formatNumber } from "../format";
import { itemTooltip } from "../tooltip";
import { showInCodex } from "./codexLink";
import RecipeLine from "./RecipeLine.vue";

const props = defineProps<{ result: PlanResult; targets: Rate[] }>();
const emit = defineEmits<{ chooseRecipe: [item: string, recipe: string] }>();

const context = useModule();
const { data } = context.services;
const vTip = context.tip;
const names = useNames(context);

/** Left padding of a root, and the indent per level, in pixels. */
const PAD = 8;
const INDENT = 12;
/** Where a level's guide line runs: under the middle of its parent's chevron. */
const CHEVRON_MIDDLE = 12;

const chain = computed(() => productionChain(props.result, props.targets));

/** Folded nodes by key; everything starts open. */
const folded = reactive(new Set<string>());

/** The nodes to show, top to bottom, with their depth. */
const visible = computed(() => {
  const out: { node: ChainNode; depth: number }[] = [];
  const walk = (node: ChainNode, depth: number) => {
    out.push({ node, depth });
    if (!folded.has(node.key)) for (const child of node.children) walk(child, depth + 1);
  };
  for (const root of chain.value) walk(root, 0);
  return out;
});

function toggle(key: string) {
  if (folded.has(key)) folded.delete(key);
  else folded.add(key);
}

const rate = (node: { item: string }, perMinute: number) => rateText(data, node.item, perMinute, locale(), t);

function partText(part: ChainPart): string {
  return part.source === "byproduct" ? t("chain.byproduct", { item: names.item(part.from ?? "") }) : t(`chain.${part.source}`);
}

/** A node with no row and one source says it on its own line; otherwise each part gets a line under it. */
const inlinePart = (node: ChainNode) => (!node.row && node.parts.length === 1 ? node.parts[0]! : null);

/** What follows the rate on the item line: a loop, or the one source of an item made elsewhere. */
function tagText(node: ChainNode): string | null {
  if (node.loop) return t("chain.loop");
  const part = inlinePart(node);
  return part ? partText(part) : null;
}

function machinesTip(node: ChainNode): string {
  const row = node.row!;
  return t("chain.machinesTotal", {
    building: names.building(row.building),
    exact: formatNumber(row.machines, locale(), 2),
    rounded: row.machinesRounded,
    item: names.item(row.item),
  });
}
</script>

<template>
  <div data-testid="chain">
    <div class="text-muted-foreground flex border-b text-xs">
      <span class="flex-1 px-3 py-1.5 font-medium">{{ t("results.item") }}</span>
      <span class="hidden w-32 px-2 py-1.5 font-medium @xl:block">{{ t("results.building") }}</span>
      <span class="w-20 px-3 py-1.5 text-right font-medium">{{ t("results.machines") }}</span>
    </div>
    <ul role="list">
      <li
        v-for="{ node, depth } in visible"
        :key="node.key"
        class="relative flex items-start text-sm"
        :class="depth === 0 ? ['bg-primary/10', node.key !== '0' && 'border-background border-t-12'] : undefined"
        :style="{ paddingLeft: `${PAD + depth * INDENT}px` }"
        data-testid="chain-node"
      >
        <!-- A target starts its own tree: an accent bar on the left. -->
        <span v-if="depth === 0" aria-hidden="true" class="bg-primary absolute inset-y-0 left-0 w-1" />
        <span
          v-for="level in depth"
          :key="level"
          aria-hidden="true"
          class="bg-border absolute inset-y-0 w-px"
          :style="{ left: `${PAD + (level - 1) * INDENT + CHEVRON_MIDDLE}px` }"
        />
        <div class="flex min-w-0 flex-1 items-start gap-1.5 py-1.5">
          <Button
            v-if="node.children.length"
            variant="ghost"
            size="icon-xs"
            class="text-muted-foreground relative flex-none"
            :aria-expanded="!folded.has(node.key)"
            :aria-label="t(folded.has(node.key) ? 'chain.unfold' : 'chain.fold', { item: names.item(node.item) })"
            data-testid="chain-toggle"
            @click="toggle(node.key)"
          >
            <ChevronRight v-if="folded.has(node.key)" :stroke-width="1.5" />
            <ChevronDown v-else :stroke-width="1.5" />
          </Button>
          <span v-else class="size-6 flex-none" />
          <GameIcon :icon="data.items[node.item]?.icon" :size="24" class="relative" />
          <div class="min-w-0 flex-1">
            <button
              v-tip="() => itemTooltip(data, node.item, language, locale(), t)"
              type="button"
              class="hover:text-primary focus-visible:outline-ring block max-w-full truncate text-left leading-6 font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
              :aria-label="t('results.showInCodex', { item: names.item(node.item) })"
              @click="showInCodex(context, `item:${node.item}`, names.item(node.item))"
            >
              {{ names.item(node.item) }}
              <!-- One line: Vue drops the whitespace between elements on separate lines. -->
              <span class="text-muted-foreground font-normal tabular-nums">· {{ rate(node, node.perMinute) }}</span> <span v-if="tagText(node)" class="text-muted-foreground font-normal">· {{ tagText(node) }}</span>
            </button>
            <RecipeLine v-if="node.row" :row="node.row" @choose-recipe="(item, recipe) => emit('chooseRecipe', item, recipe)" />
            <p v-if="node.row" class="text-muted-foreground mt-0.5 truncate text-xs @xl:hidden">{{ names.building(node.row.building) }}</p>
            <template v-if="!inlinePart(node)">
              <p v-for="part in node.parts" :key="`${part.source}|${part.from}`" class="text-muted-foreground truncate text-xs leading-5 tabular-nums" data-testid="chain-part">
                {{ partText(part) }} · {{ rate(node, part.perMinute) }}
              </p>
            </template>
            <p v-if="node.cut" class="text-muted-foreground truncate text-xs leading-5">{{ t("chain.more") }}</p>
          </div>
        </div>
        <div class="hidden w-32 flex-none px-2 py-1.5 @xl:block">
          <span v-if="node.row" class="flex min-w-0 items-center gap-1.5 leading-6">
            <GameIcon :icon="data.buildings[node.row.building]?.icon" kind="building" :size="20" />
            <span class="min-w-0 truncate">{{ names.building(node.row.building) }}</span>
          </span>
        </div>
        <div class="w-20 flex-none px-3 py-1.5 text-right leading-6 font-medium tabular-nums" :title="node.row ? machinesTip(node) : undefined">
          <template v-if="node.row">{{ formatNumber(node.machines, locale(), 2) }}</template>
        </div>
      </li>
    </ul>
  </div>
</template>
