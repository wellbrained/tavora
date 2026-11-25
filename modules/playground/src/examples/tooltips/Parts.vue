<script setup lang="ts">
// A card put together from the tooltip's parts: a badge beside the title (`badge`, or the `badges` slot), small text at
// the right (`meta`, or the `meta` slot), a line under the head (`divider`) and rows with a unit in a column of its own
// (`unit`). With several values per row, `columns` puts headings over them; a "–" is drawn faint and each value can
// have its own trend. `width="md"` makes room for the columns.
import { Tooltip, TooltipRows, type TooltipRow } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { computed, ref } from "vue";
import { t } from "../../i18n";

const tip = ref<{ open: string | null; anchor: { left: number; top: number; right: number; bottom: number } }>({ open: null, anchor: { left: 0, top: 0, right: 0, bottom: 0 } });
function show(name: string, event: Event) {
  const { left, top, right, bottom } = (event.currentTarget as HTMLElement).getBoundingClientRect();
  tip.value = { open: name, anchor: { left, top, right, bottom } };
}
const hide = () => (tip.value.open = null);
const tipFor = (name: string) => ({ onPointerenter: (e: Event) => show(name, e), onPointerleave: hide, onFocus: (e: Event) => show(name, e), onBlur: hide });

const head = computed(() => ({
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
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="outline" v-bind="tipFor('skill')" hinted>{{ head.fireball }}</Button>
    <Button variant="outline" class="max-w-40" v-bind="tipFor('long')" hinted><span class="truncate">{{ head.longName }}</span></Button>
    <Button variant="outline" v-bind="tipFor('levels')" hinted>{{ head.venom }}</Button>
  </div>
  <Tooltip :open="tip.open === 'skill'" :anchor="tip.anchor" side="right" :title="head.fireball" :badge="head.active" :meta="head.level" divider @dismiss="hide">
    <TooltipRows :rows="skillRows" />
  </Tooltip>
  <Tooltip :open="tip.open === 'long'" :anchor="tip.anchor" side="right" :title="head.longName" :badge="head.passive" :meta="head.replaced" divider @dismiss="hide">
    <TooltipRows :rows="skillRows.slice(0, 2)" />
  </Tooltip>
  <Tooltip :open="tip.open === 'levels'" :anchor="tip.anchor" side="right" width="md" :title="head.venom" :badge="head.powerUp" :description="head.venomText" divider @dismiss="hide">
    <TooltipRows :rows="levelRows" :columns="rarities" />
  </Tooltip>
</template>
