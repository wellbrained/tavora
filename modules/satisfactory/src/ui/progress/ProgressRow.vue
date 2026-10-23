<script setup lang="ts">
// One entry of the Progress panel: a tick, its name and cost, what it unlocks
// (each a link into the Codex), what it still waits for, and Plan this.
import { Factory, HardDrive } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { computed, useId } from "vue";
import type { Amount, Unlocks } from "../../contracts/data";
import { language, locale, t } from "../../i18n";
import GameIcon from "../common/GameIcon.vue";
import { useModule, useNames } from "../context";
import { formatNumber } from "../format";
import { showInCodex } from "../planner/codexLink";
import { itemTooltip } from "../tooltip";

const props = withDefaults(
  defineProps<{
    label: string;
    done: boolean;
    /** Phase 0 is where every game starts: shown, never ticked. */
    checkable?: boolean;
    cost?: Amount[];
    hardDrives?: number;
    detail?: string;
    unlocks?: Unlocks;
    needs?: string[];
    canPlan?: boolean;
    testid?: string;
  }>(),
  { checkable: true, cost: () => [], needs: () => [], canPlan: false },
);
const emit = defineEmits<{ toggle: [on: boolean]; plan: [] }>();

const context = useModule();
const { data } = context.services;
const vTip = context.tip;
const names = useNames(context);
const id = useId();

const links = computed(() => {
  const unlocks = props.unlocks;
  if (!unlocks) return [];
  return [
    ...unlocks.buildings.map((building) => ({ key: `building:${building}`, name: names.building(building) })),
    ...unlocks.recipes.map((recipe) => ({ key: `recipe:${recipe}`, name: names.recipe(recipe) })),
    ...unlocks.items.map((item) => ({ key: `item:${item}`, name: names.item(item) })),
  ];
});
</script>

<template>
  <li class="flex min-w-0 gap-3 border-b px-3 py-2.5 last:border-b-0" :data-testid="testid" :data-done="done">
    <Checkbox
      v-if="checkable"
      :id="id"
      class="mt-0.5 flex-none"
      :model-value="done"
      data-testid="progress-tick"
      @update:model-value="(on: boolean | 'indeterminate') => emit('toggle', on === true)"
    />
    <span v-else class="w-4 flex-none" />
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <div class="flex min-w-0 items-start gap-2">
        <label :for="checkable ? id : undefined" class="min-w-0 flex-1 text-sm font-medium" :class="done ? 'text-muted-foreground' : ''">
          {{ label }}
        </label>
        <Button
          v-if="canPlan"
          variant="ghost"
          size="sm"
          class="-my-1 flex-none"
          :aria-label="t('progress.planThisFor', { name: label })"
          :title="t('progress.planThisFor', { name: label })"
          data-testid="progress-plan"
          @click="emit('plan')"
        >
          <Factory :stroke-width="1.5" />
          <span class="hidden @md:inline">{{ t("codex.planThis") }}</span>
        </Button>
      </div>
      <p v-if="detail" class="text-muted-foreground text-xs">{{ detail }}</p>
      <ul v-if="cost.length || hardDrives" class="flex flex-wrap items-center gap-x-3 gap-y-1" role="list" :aria-label="t('progress.cost')">
        <li v-for="part in cost" :key="part.item" v-tip="() => itemTooltip(data, part.item, language, locale(), t)" class="flex items-center gap-1 text-xs tabular-nums">
          <GameIcon :icon="data.items[part.item]?.icon" :size="18" />
          <span>{{ formatNumber(part.amount, locale(), 0) }}</span>
          <span class="sr-only">{{ names.item(part.item) }}</span>
        </li>
        <li v-if="hardDrives" class="flex items-center gap-1 text-xs tabular-nums">
          <HardDrive class="text-muted-foreground size-4" :stroke-width="1.5" />
          <span>{{ t("progress.hardDrives", { count: hardDrives }) }}</span>
        </li>
      </ul>
      <p v-if="links.length" class="text-muted-foreground text-xs leading-relaxed">
        {{ t("progress.unlocks") }}
        <template v-for="(link, index) in links" :key="link.key">
          <button type="button" class="text-foreground hover:underline focus-visible:underline" data-testid="progress-unlock" @click="showInCodex(context, link.key, link.name)">{{ link.name }}</button><span v-if="index < links.length - 1">, </span>
        </template>
      </p>
      <p v-if="needs.length && !done" class="text-muted-foreground text-xs" data-testid="progress-needs">{{ t("progress.needs", { list: needs.join(", ") }) }}</p>
    </div>
  </li>
</template>
