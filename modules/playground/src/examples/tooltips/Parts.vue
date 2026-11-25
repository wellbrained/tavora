<script setup lang="ts">
// A card put together from the tooltip's parts: a badge beside the title (`badge`, or the `badges` slot), small text at
// the right (`meta`, or the `meta` slot), a line under the head (`divider`) and rows with a unit in a column of its own
// (`unit`). With several values per row, `columns` puts headings over them; a "–" is drawn faint and each value can
// have its own trend. `width="md"` makes room for the columns. One Tooltip shows whichever card `useTooltip` has.
import { Tooltip, TooltipRows, useTooltip, type TooltipRow, type TooltipWidth } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { computed } from "vue";
import { t } from "../../i18n";

const text = computed(() => ({
  fireball: t("demo.tipParts.fireball"),
  longName: t("demo.tipParts.longName"),
  venom: t("demo.tipParts.venom"),
  venomText: t("demo.tipParts.venomText"),
  active: t("demo.tipParts.active"),
  passive: t("demo.tipParts.passive"),
  powerUp: t("demo.tipParts.powerUp"),
  level: t("demo.tipParts.level", { level: 3 }),
  replaced: t("demo.tipParts.replaced"),
}));
const skillRows = computed<TooltipRow[]>(() => [
  { label: t("demo.tipParts.damage"), value: "12,480" },
  { label: t("demo.tipParts.share"), value: "34", unit: "%" },
  { label: t("demo.tipParts.time"), value: "4:12", unit: t("demo.tipParts.minutes") },
  { label: t("demo.tipParts.dps"), value: "49.5" },
]);
const rarities = computed(() => [t("demo.tipParts.common"), t("demo.tipParts.rare"), t("demo.tipParts.epic")]);
const levelRows = computed<TooltipRow[]>(() => [
  { label: t("demo.tipParts.poison"), values: ["4", "6", "9"], unit: "%" },
  { label: t("demo.tipParts.duration"), values: ["2", "–", "3"], unit: "s" },
  { label: t("demo.tipParts.stacks"), values: ["1", "2", "3"], trend: [undefined, "better", "better"] },
]);

interface Card {
  title: string;
  badge: string;
  meta?: string;
  description?: string;
  rows: TooltipRow[];
  columns?: string[];
  width?: TooltipWidth;
}
const cards = computed<Record<"skill" | "long" | "levels", Card>>(() => ({
  skill: { title: text.value.fireball, badge: text.value.active, meta: text.value.level, rows: skillRows.value },
  long: { title: text.value.longName, badge: text.value.passive, meta: text.value.replaced, rows: skillRows.value.slice(0, 2) },
  levels: { title: text.value.venom, badge: text.value.powerUp, description: text.value.venomText, rows: levelRows.value, columns: rarities.value, width: "md" },
}));
const tip = useTooltip<Card>({ side: "right" });
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="outline" v-bind="tip.on(cards.skill)" hinted>{{ text.fireball }}</Button>
    <Button variant="outline" class="max-w-40" v-bind="tip.on(cards.long)" hinted><span class="truncate">{{ text.longName }}</span></Button>
    <Button variant="outline" v-bind="tip.on(cards.levels)" hinted>{{ text.venom }}</Button>
  </div>
  <Tooltip v-bind="tip.props" :title="tip.content?.title" :badge="tip.content?.badge" :meta="tip.content?.meta" :description="tip.content?.description" :width="tip.content?.width" divider>
    <TooltipRows v-if="tip.content" :rows="tip.content.rows" :columns="tip.content.columns" />
  </Tooltip>
</template>
