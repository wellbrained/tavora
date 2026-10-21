<script setup lang="ts">
// One Codex entry in full: an item, a recipe or a building, with links to the entries around it.
import { BookOpen, Factory } from "@lucide/vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { computed } from "vue";
import type { Localized } from "../../contracts/data";
import { language, locale, t } from "../../i18n";
import GameIcon from "../common/GameIcon.vue";
import { useModule } from "../context";
import { amountText } from "../describe";
import { formatNumber, formatPower } from "../format";
import { localize } from "../names";
import { canPlan, recipesMaking, recipesUsing } from "../planEdit";
import type { Entry } from "../search";
import EntryLink from "./EntryLink.vue";
import RecipeCard from "./RecipeCard.vue";

const props = defineProps<{ entry: Entry }>();
const emit = defineEmits<{ go: [entry: Entry]; planThis: [item: string]; wiki: [name: Localized] }>();

const { data } = useModule().services;

const item = computed(() => (props.entry.kind === "item" ? data.items[props.entry.id] : undefined));
const recipe = computed(() => (props.entry.kind === "recipe" ? data.recipes[props.entry.id] : undefined));
const building = computed(() => (props.entry.kind === "building" ? data.buildings[props.entry.id] : undefined));

const madeBy = computed(() => (item.value ? recipesMaking(data, item.value.id) : []));
const usedIn = computed(() => (item.value ? recipesUsing(data, item.value.id) : []));
const runs = computed(() =>
  building.value ? Object.values(data.recipes).filter((entry) => entry.producedIn.includes(building.value!.id)).sort((a, b) => Number(a.alternate) - Number(b.alternate) || a.id.localeCompare(b.id)) : [],
);
const isResource = computed(() => !!item.value && data.resources.includes(item.value.id));

const itemFacts = computed(() => {
  const value = item.value;
  if (!value) return [];
  return [
    ...(value.stackSize !== undefined ? [{ label: t("codex.stack"), value: formatNumber(value.stackSize, locale()) }] : []),
    { label: t("codex.sink"), value: value.sinkPoints !== undefined ? formatNumber(value.sinkPoints, locale()) : t("codex.sinkNone") },
    ...(value.energyMJ !== undefined ? [{ label: t("codex.energy"), value: `${formatNumber(value.energyMJ, locale())} MJ` }] : []),
  ];
});

const buildingPower = computed(() => {
  const value = building.value;
  if (!value) return "";
  if (value.powerMW !== undefined) return formatPower(value.powerMW, locale());
  return runs.value.some((entry) => entry.variablePowerMW) ? t("codex.powerVariable") : t("codex.powerNone");
});

const go = (next: Entry) => emit("go", next);
</script>

<template>
  <article class="@container flex min-w-0 flex-col gap-4" data-testid="codex-entry" :data-kind="entry.kind">
    <!-- Item -->
    <template v-if="item">
      <header class="flex min-w-0 items-start gap-3">
        <GameIcon :icon="item.icon" :size="48" />
        <div class="min-w-0 flex-1">
          <h2 class="text-lg font-semibold">{{ localize(item.name, language) }}</h2>
          <div class="mt-1 flex flex-wrap gap-1">
            <Badge variant="secondary">{{ t(`kind.${item.kind}`) }}</Badge>
            <Badge variant="outline">{{ t(`form.${item.form}`) }}</Badge>
          </div>
        </div>
      </header>
      <div class="flex flex-wrap gap-2">
        <Button v-if="canPlan(data, item.id)" size="sm" data-testid="plan-this" @click="emit('planThis', item.id)">
          <Factory :stroke-width="1.5" />{{ t("codex.planThis") }}
        </Button>
        <Button size="sm" variant="secondary" :title="t('codex.wikiFor', { name: item.name.en })" data-testid="wiki" @click="emit('wiki', item.name)">
          <BookOpen :stroke-width="1.5" />{{ t("codex.wiki") }}
        </Button>
      </div>
      <p v-if="localize(item.description, language)" class="text-muted-foreground text-sm">{{ localize(item.description, language) }}</p>
      <dl class="bg-card grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border p-3 text-sm">
        <template v-for="fact in itemFacts" :key="fact.label">
          <dt class="text-muted-foreground">{{ fact.label }}</dt>
          <dd class="tabular-nums">{{ fact.value }}</dd>
        </template>
      </dl>

      <section :aria-label="t('codex.madeBy')" data-testid="made-by">
        <h3 class="mb-2 text-sm font-semibold">{{ t("codex.madeBy") }}</h3>
        <p v-if="isResource" class="text-muted-foreground text-sm">{{ t("codex.resource") }}</p>
        <p v-else-if="!madeBy.length" class="text-muted-foreground text-sm">{{ t("codex.notMade") }}</p>
        <div class="flex flex-col gap-2">
          <RecipeCard v-for="entry in madeBy" :key="entry.id" :recipe-id="entry.id" :focus="item.id" @go="go" />
        </div>
      </section>
      <section :aria-label="t('codex.usedIn')" data-testid="used-in">
        <h3 class="mb-2 text-sm font-semibold">{{ t("codex.usedIn") }}</h3>
        <p v-if="!usedIn.length" class="text-muted-foreground text-sm">{{ t("codex.notUsed") }}</p>
        <div class="flex flex-col gap-2">
          <RecipeCard v-for="entry in usedIn" :key="entry.id" :recipe-id="entry.id" :focus="item.id" @go="go" />
        </div>
      </section>
    </template>

    <!-- Recipe -->
    <template v-else-if="recipe">
      <header class="flex min-w-0 flex-wrap items-center gap-2">
        <h2 class="text-lg font-semibold">{{ localize(recipe.name, language) }}</h2>
        <Badge v-if="recipe.alternate" variant="outline">{{ t("codex.alternate") }}</Badge>
      </header>
      <RecipeCard :recipe-id="recipe.id" :title="false" @go="go" />
    </template>

    <!-- Building -->
    <template v-else-if="building">
      <header class="flex min-w-0 items-start gap-3">
        <GameIcon :icon="building.icon" kind="building" :size="48" />
        <div class="min-w-0 flex-1">
          <h2 class="text-lg font-semibold">{{ localize(building.name, language) }}</h2>
          <div class="mt-1 flex flex-wrap gap-1">
            <Badge variant="secondary">{{ t(building.kind === "other" ? "buildingKind.misc" : `buildingKind.${building.kind}`) }}</Badge>
          </div>
        </div>
      </header>
      <div class="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" :title="t('codex.wikiFor', { name: building.name.en })" data-testid="wiki" @click="emit('wiki', building.name)">
          <BookOpen :stroke-width="1.5" />{{ t("codex.wiki") }}
        </Button>
      </div>
      <p v-if="localize(building.description, language)" class="text-muted-foreground text-sm">{{ localize(building.description, language) }}</p>
      <dl class="bg-card grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border p-3 text-sm">
        <dt class="text-muted-foreground">{{ t("codex.power") }}</dt>
        <dd class="tabular-nums">{{ buildingPower }}</dd>
      </dl>
      <section :aria-label="t('codex.buildCost')" data-testid="build-cost">
        <h3 class="mb-2 text-sm font-semibold">{{ t("codex.buildCost") }}</h3>
        <p v-if="!building.buildCost.length" class="text-muted-foreground text-sm">{{ t("codex.noBuildCost") }}</p>
        <ul class="bg-card flex flex-col gap-1 rounded-lg border p-3" :class="building.buildCost.length ? '' : 'hidden'" role="list">
          <li v-for="cost in building.buildCost" :key="cost.item" class="flex min-w-0 items-center gap-2 text-sm">
            <EntryLink :entry="{ kind: 'item', id: cost.item }" class="flex-1" @go="go" />
            <span class="flex-none tabular-nums">{{ amountText(data, cost.item, cost.amount, locale()) }}</span>
          </li>
        </ul>
      </section>
      <section :aria-label="t('codex.recipesRun')" data-testid="runs">
        <h3 class="mb-2 text-sm font-semibold">{{ t("codex.recipesRun") }}</h3>
        <p v-if="!runs.length" class="text-muted-foreground text-sm">{{ t("codex.noRecipes") }}</p>
        <div class="flex flex-col gap-2">
          <RecipeCard v-for="entry in runs" :key="entry.id" :recipe-id="entry.id" @go="go" />
        </div>
      </section>
    </template>

    <p v-else class="text-muted-foreground text-sm">{{ t("codex.gone") }}</p>
  </article>
</template>
