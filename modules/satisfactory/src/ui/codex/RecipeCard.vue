<script setup lang="ts">
// One recipe at a glance: what goes in and comes out per minute, where it is made and how it unlocks.
import { ArrowRight } from "@lucide/vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { computed } from "vue";
import { language, locale, t } from "../../i18n";
import { useModule } from "../context";
import { rateText, unlockText } from "../describe";
import { formatNumber } from "../format";
import { perMinute } from "../planEdit";
import type { Entry } from "../search";
import EntryLink from "./EntryLink.vue";

const props = defineProps<{ recipeId: string; /** The item the card is shown for; its line is not a link. */ focus?: string; hideTitle?: boolean }>();
const emit = defineEmits<{ go: [entry: Entry] }>();

const context = useModule();
const { data } = context.services;
const recipe = computed(() => data.recipes[props.recipeId]);
const unlocks = computed(() =>
  recipe.value?.unlockedBy.length ? recipe.value.unlockedBy.map((unlock) => unlockText(unlock, language.value, t)).join(", ") : t("unlock.unknown"),
);
</script>

<template>
  <article v-if="recipe" class="bg-card min-w-0 rounded-lg border p-3" data-testid="recipe-card">
    <header v-if="!hideTitle" class="mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <EntryLink :entry="{ kind: 'recipe', id: recipe.id }" class="font-medium" @go="(entry) => emit('go', entry)" />
    </header>
    <div class="flex flex-col gap-2 @md:flex-row @md:items-center">
      <ul class="flex min-w-0 flex-1 flex-col gap-1" role="list" :aria-label="t('codex.ingredients')">
        <li v-for="entry in recipe.ingredients" :key="entry.item" class="flex min-w-0 items-center gap-2 text-sm">
          <EntryLink :entry="{ kind: 'item', id: entry.item }" class="flex-1" @go="(next) => emit('go', next)" />
          <span class="text-muted-foreground flex-none text-xs tabular-nums">{{ rateText(data, entry.item, perMinute(recipe, entry.amount), locale(), t) }}</span>
        </li>
      </ul>
      <ArrowRight class="text-muted-foreground hidden size-4 flex-none @md:block" :stroke-width="1.5" />
      <ul class="flex min-w-0 flex-1 flex-col gap-1 border-t pt-2 @md:border-t-0 @md:pt-0" role="list" :aria-label="t('codex.products')">
        <li v-for="(entry, index) in recipe.products" :key="entry.item" class="flex min-w-0 items-center gap-2 text-sm">
          <EntryLink :entry="{ kind: 'item', id: entry.item }" class="flex-1" :class="entry.item === focus ? 'font-medium' : ''" @go="(next) => emit('go', next)" />
          <Badge v-if="index > 0" variant="secondary" class="flex-none">{{ t("codex.byproduct") }}</Badge>
          <span class="text-muted-foreground flex-none text-xs tabular-nums">{{ rateText(data, entry.item, perMinute(recipe, entry.amount), locale(), t) }}</span>
        </li>
      </ul>
    </div>
    <dl class="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      <div v-if="recipe.producedIn.length" class="flex min-w-0 items-center gap-1">
        <dt class="sr-only">{{ t("codex.madeIn") }}</dt>
        <dd class="flex min-w-0 flex-wrap gap-x-2">
          <EntryLink v-for="building in recipe.producedIn" :key="building" :entry="{ kind: 'building', id: building }" :size="16" @go="(next) => emit('go', next)" />
        </dd>
      </div>
      <div class="flex gap-1">
        <dt>{{ t("codex.time") }}</dt>
        <dd class="tabular-nums">{{ t("codex.duration", { seconds: formatNumber(recipe.durationSeconds, locale()) }) }}</dd>
      </div>
      <div class="flex min-w-0 gap-1">
        <dt>{{ t("codex.unlock") }}</dt>
        <dd class="min-w-0">{{ unlocks }}</dd>
      </div>
    </dl>
  </article>
</template>
