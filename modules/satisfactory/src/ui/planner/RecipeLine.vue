<script setup lang="ts">
// The recipe under an item in the results: a picker when there are other recipes, else a Codex link,
// and nothing when the only recipe is named like its item.
import { ChevronDown } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import type { MenuEntry } from "@tavora/sdk";
import type { RecipeRow } from "../../contracts/plan";
import { language, locale, t } from "../../i18n";
import { useModule, useNames } from "../context";
import { recipeTooltip } from "../tooltip";
import { showInCodex } from "./codexLink";

const props = defineProps<{ row: RecipeRow }>();
const emit = defineEmits<{ chooseRecipe: [item: string, recipe: string] }>();

const context = useModule();
const { sdk } = context;
const { data } = context.services;
const vTip = context.tip;
const names = useNames(context);

async function pickRecipe(event: MouseEvent) {
  const row = props.row;
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const items: MenuEntry[] = row.alternatives.map((id) => ({
    type: "item",
    id,
    label: names.recipe(id),
    radio: true,
    checked: id === row.recipe,
  }));
  const choice = await sdk.ui.showMenu({ items, at: { x: box.left, y: box.top, width: box.width, height: box.height } }).catch(() => null);
  if (choice && choice !== row.recipe) emit("chooseRecipe", row.item, choice);
}
</script>

<template>
  <div v-if="row.alternatives.length > 1 || names.recipe(row.recipe) !== names.item(row.item)" class="flex min-w-0 items-center gap-1">
    <Button
      v-if="row.alternatives.length > 1"
      v-tip="() => recipeTooltip(data, row.recipe, language, locale(), t)"
      variant="ghost"
      size="xs"
      class="text-muted-foreground -ml-2 min-w-0 shrink"
      :aria-label="`${t('results.pickRecipe', { item: names.item(row.item) })}: ${names.recipe(row.recipe)}`"
      data-testid="recipe-picker"
      @click="pickRecipe"
    >
      <span class="truncate">{{ names.recipe(row.recipe) }}</span>
      <ChevronDown :stroke-width="1.5" />
    </Button>
    <button
      v-else
      v-tip="() => recipeTooltip(data, row.recipe, language, locale(), t)"
      type="button"
      class="text-muted-foreground hover:text-primary focus-visible:outline-ring min-w-0 truncate text-left text-xs leading-6 focus-visible:outline-2 focus-visible:outline-offset-2"
      :aria-label="t('results.showInCodex', { item: names.recipe(row.recipe) })"
      @click="showInCodex(context, `recipe:${row.recipe}`, names.recipe(row.recipe))"
    >
      {{ names.recipe(row.recipe) }}
    </button>
  </div>
</template>
