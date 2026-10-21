<script setup lang="ts">
// A catalog module's rating on its card, the way stores show it: the average, five stars rounded to the
// nearest half, an arrow that opens how many gave 1 to 5 stars, and how many rated. Below MIN_RATINGS_SHOWN
// it shows only how many rated, or that nobody has yet. Ratings are every version's together, as the service counts them (reviews.ts).
import { ChevronDown } from "@lucide/vue";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { Progress } from "@tavora/official-ui/components/ui/progress";
import { StarRating } from "@tavora/official-ui/components/ui/star-rating";
import { computed } from "vue";
import { MIN_RATINGS_SHOWN, type CatalogRating } from "../../shared/host-api";
import { useFloating } from "../host";
import { formatNumber, t } from "../i18n";

const props = defineProps<{ rating: CatalogRating | null; name: string }>();
const emit = defineEmits<{ reviews: [] }>();
const track = useFloating();

const shown = computed(() => (props.rating && props.rating.count >= MIN_RATINGS_SHOWN ? props.rating : null));
const average = computed(() => (shown.value ? formatNumber(shown.value.average) : ""));
/** 5 stars first, each with its share in whole percent. */
const rows = computed(() =>
  shown.value
    ? [5, 4, 3, 2, 1].map((stars) => ({ stars, percent: Math.round(((shown.value!.stars[stars - 1] ?? 0) / shown.value!.count) * 100) }))
    : [],
);
</script>

<template>
  <span v-if="!shown" class="text-muted-foreground text-xs" :title="t('catalog.rating.newHint')" data-testid="catalog-rating-new">
    {{ rating ? t("catalog.rating.count", { count: rating.count }) : t("catalog.rating.none") }}
  </span>
  <DropdownMenu v-else @update:open="track">
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        class="hover:text-foreground focus-visible:ring-ring data-[state=open]:text-foreground text-muted-foreground inline-flex items-center gap-1.5 rounded-sm text-xs outline-none focus-visible:ring-2"
        :aria-label="`${t('catalog.rating.breakdown', { name })}: ${t('catalog.rating.label', { average })}, ${t('catalog.rating.count', { count: shown.count })}`"
        data-testid="catalog-rating"
      >
        <span class="text-foreground font-medium tabular-nums">{{ average }}</span>
        <StarRating :model-value="shown.average" size="sm" :label="t('catalog.rating.label', { average })" />
        <ChevronDown class="size-3.5" :stroke-width="1.5" />
        <span class="tabular-nums">({{ formatNumber(shown.count) }})</span>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-64" data-testid="catalog-rating-breakdown">
      <DropdownMenuLabel class="flex items-center gap-2 font-normal">
        <StarRating :model-value="shown.average" :label="t('catalog.rating.label', { average })" />
        <span class="text-sm">{{ t("catalog.rating.label", { average }) }}</span>
      </DropdownMenuLabel>
      <p class="text-muted-foreground px-2 pb-2 text-xs">{{ t("catalog.rating.count", { count: shown.count }) }}</p>
      <ul class="space-y-1.5 px-2 pb-2">
        <li v-for="row in rows" :key="row.stars" class="grid grid-cols-[3.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs">
          <span class="text-muted-foreground">{{ t("catalog.rating.stars", { count: row.stars }) }}</span>
          <Progress :model-value="row.percent" :aria-label="t('catalog.rating.stars', { count: row.stars })" />
          <span class="text-muted-foreground text-right tabular-nums">{{ t("catalog.rating.percent", { percent: row.percent }) }}</span>
        </li>
      </ul>
      <DropdownMenuSeparator />
      <DropdownMenuItem data-testid="catalog-rating-reviews" @select="emit('reviews')">{{ t("catalog.rating.all") }}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
