<script setup lang="ts">
// The solved plan: the production as a chain, a graph or a list, then power, what goes in and comes out, and build cost.
import { Zap } from "@lucide/vue";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@tavora/official-ui/components/ui/tabs";
import { computed, onMounted, ref } from "vue";
import type { PlanResult, Rate, RecipeRow } from "../../contracts/plan";
import { language, locale, t } from "../../i18n";
import GameIcon from "../common/GameIcon.vue";
import { useModule, useNames } from "../context";
import { amountText, rateText } from "../describe";
import { formatClock, formatNumber, formatPower } from "../format";
import { itemTooltip } from "../tooltip";
import ChainView from "./ChainView.vue";
import { showInCodex } from "./codexLink";
import FlowView from "./FlowView.vue";
import ItemList from "./ItemList.vue";
import RecipeLine from "./RecipeLine.vue";

const props = defineProps<{ result: PlanResult; targets: Rate[] }>();
const emit = defineEmits<{ chooseRecipe: [item: string, recipe: string] }>();

const context = useModule();
const { sdk } = context;
const { data } = context.services;
const vTip = context.tip;
const names = useNames(context);

const VIEWS = ["chain", "graph", "list"] as const;
type ProductionView = (typeof VIEWS)[number];
const isView = (value: unknown): value is ProductionView => VIEWS.includes(value as ProductionView);
/** What a Planner panel keeps in its panel state. */
interface PanelState {
  productionView?: ProductionView;
}

/** Chain, Graph or List; each Planner panel remembers its own. */
const view = ref<ProductionView>("chain");
onMounted(async () => {
  const state = await sdk.panel.getState<PanelState>().catch(() => null);
  if (isView(state?.productionView)) view.value = state.productionView;
});
function setView(next: string | number) {
  if (!isView(next)) return;
  view.value = next;
  void sdk.panel.setState({ productionView: next } satisfies PanelState).catch(() => undefined);
}

const rateEntries = (rates: Rate[]) => rates.map((rate) => ({ item: rate.item, text: rateText(data, rate.item, rate.perMinute, locale(), t) }));

const lists = computed(() =>
  [
    { key: "raw", title: t("results.raw"), entries: rateEntries(props.result.rawResources) },
    {
      key: "imports",
      title: t("results.imports"),
      hint: t("results.importsHint"),
      entries: rateEntries(props.result.imports).map((entry) =>
        props.result.notUnlocked.includes(entry.item) ? { ...entry, note: t("results.notUnlocked") } : entry,
      ),
    },
    { key: "fixed", title: t("results.fixedUsed"), entries: rateEntries(props.result.fixedInputsUsed) },
    { key: "byproducts", title: t("results.byproducts"), entries: rateEntries(props.result.byproducts) },
    { key: "surplus", title: t("results.surplus"), entries: rateEntries(props.result.surplus) },
    {
      key: "cost",
      title: t("results.buildCost"),
      entries: props.result.buildCost.map((amount) => ({ item: amount.item, text: amountText(data, amount.item, amount.amount, locale()) })),
    },
  ].filter((list) => list.entries.length),
);

const madeRate = (row: RecipeRow) => row.outputs.find((output) => output.item === row.item);
</script>

<template>
  <div class="@container flex flex-col gap-3" data-testid="results">
    <Tabs as-child :model-value="view" @update:model-value="setView">
      <section class="bg-card min-w-0 overflow-hidden rounded-lg border">
        <div class="flex items-center gap-2 px-3 pt-2">
          <h3 class="min-w-0 flex-1 truncate text-sm font-semibold">{{ t("results.production") }}</h3>
          <TabsList :aria-label="t('results.showAs')">
            <TabsTrigger value="chain" data-testid="view-chain">{{ t("results.chain") }}</TabsTrigger>
            <TabsTrigger value="graph" data-testid="view-graph">{{ t("results.graph") }}</TabsTrigger>
            <TabsTrigger value="list" data-testid="view-list">{{ t("results.list") }}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="chain">
          <ChainView :result="result" :targets="targets" @choose-recipe="(item, recipe) => emit('chooseRecipe', item, recipe)" />
        </TabsContent>
        <TabsContent value="graph" class="mt-2 border-t">
          <FlowView :result="result" :targets="targets" @choose-recipe="(item, recipe) => emit('chooseRecipe', item, recipe)" />
        </TabsContent>
        <TabsContent value="list">
          <table class="w-full table-fixed border-collapse text-sm" data-testid="result-rows">
            <thead class="text-muted-foreground text-xs">
              <tr class="border-b">
                <th class="px-3 py-1.5 text-left font-medium">{{ t("results.item") }}</th>
                <th class="hidden w-32 px-2 py-1.5 text-left font-medium @xl:table-cell">{{ t("results.building") }}</th>
                <th class="w-20 px-2 py-1.5 text-right font-medium">{{ t("results.machines") }}</th>
                <th class="hidden w-24 px-2 py-1.5 text-right font-medium @lg:table-cell">{{ t("results.clock") }}</th>
                <th class="hidden w-24 px-3 py-1.5 text-right font-medium @lg:table-cell">{{ t("results.power") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in result.rows" :key="`${row.item}|${row.recipe}`" class="border-b last:border-b-0 align-top" data-testid="result-row">
                <td class="min-w-0 px-3 py-2">
                  <div class="flex min-w-0 items-center gap-2">
                    <GameIcon :icon="data.items[row.item]?.icon" :size="28" />
                    <div class="min-w-0 flex-1">
                      <button
                        v-tip="() => itemTooltip(data, row.item, language, locale(), t)"
                        type="button"
                        class="hover:text-primary focus-visible:outline-ring block max-w-full truncate text-left font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
                        :aria-label="t('results.showInCodex', { item: names.item(row.item) })"
                        @click="showInCodex(context, `item:${row.item}`, names.item(row.item))"
                      >
                        {{ names.item(row.item) }}
                        <span v-if="madeRate(row)" class="text-muted-foreground font-normal tabular-nums">· {{ rateText(data, row.item, madeRate(row)!.perMinute, locale(), t) }}</span>
                      </button>
                      <RecipeLine :row="row" @choose-recipe="(item, recipe) => emit('chooseRecipe', item, recipe)" />
                      <!-- Narrow panels: what the hidden columns hold, on one line. -->
                      <p class="text-muted-foreground mt-0.5 truncate text-xs tabular-nums @lg:hidden">
                        {{ names.building(row.building) }} · {{ formatClock(row.clockPercent, locale()) }} · {{ formatPower(row.powerMW, locale()) }}
                      </p>
                      <p class="text-muted-foreground mt-0.5 hidden truncate text-xs @lg:block @xl:hidden">{{ names.building(row.building) }}</p>
                    </div>
                  </div>
                </td>
                <td class="hidden px-2 py-2 @xl:table-cell">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <GameIcon :icon="data.buildings[row.building]?.icon" kind="building" :size="20" />
                    <span class="min-w-0 truncate">{{ names.building(row.building) }}</span>
                  </span>
                </td>
                <td class="px-2 py-2 text-right tabular-nums" :title="t('results.machinesExact', { exact: formatNumber(row.machines, locale(), 4), rounded: row.machinesRounded })">
                  <span class="font-medium">{{ row.machinesRounded }}</span>
                  <span v-if="Math.abs(row.machines - row.machinesRounded) > 1e-6" class="text-muted-foreground block text-xs">{{ formatNumber(row.machines, locale(), 2) }}</span>
                </td>
                <td class="hidden px-2 py-2 text-right tabular-nums @lg:table-cell">{{ formatClock(row.clockPercent, locale()) }}</td>
                <td class="hidden px-3 py-2 text-right tabular-nums @lg:table-cell">{{ formatPower(row.powerMW, locale()) }}</td>
              </tr>
            </tbody>
          </table>
        </TabsContent>
      </section>
    </Tabs>

    <section class="bg-card flex items-center gap-2 rounded-lg border px-3 py-2" data-testid="total-power">
      <Zap class="text-muted-foreground size-4" :stroke-width="1.5" />
      <span class="flex-1 text-sm font-semibold">{{ t("results.totalPower") }}</span>
      <span class="text-sm font-semibold tabular-nums">{{ formatPower(result.powerMW, locale()) }}</span>
    </section>

    <div class="grid gap-3 @2xl:grid-cols-2">
      <ItemList v-for="list in lists" :key="list.key" :title="list.title" :hint="list.hint" :entries="list.entries" :testid="`list-${list.key}`" />
    </div>
  </div>
</template>
