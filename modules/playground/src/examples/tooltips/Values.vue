<script setup lang="ts">
import { Tooltip, TooltipRows, type TooltipRow } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Separator } from "@tavora/official-ui/components/ui/separator";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

const tip = ref<{ open: string | null; anchor: { left: number; top: number; right: number; bottom: number } }>({ open: null, anchor: { left: 0, top: 0, right: 0, bottom: 0 } });
function show(name: string, event: Event) {
  const { left, top, right, bottom } = (event.currentTarget as HTMLElement).getBoundingClientRect();
  tip.value = { open: name, anchor: { left, top, right, bottom } };
}
const hide = () => (tip.value.open = null);
const tipFor = (name: string) => ({ onPointerenter: (e: Event) => show(name, e), onPointerleave: hide, onFocus: (e: Event) => show(name, e), onBlur: hide });

const chartRows: TooltipRow[] = [{ label: "Play time", value: "3 h 12 min" }, { label: "vs. last week", value: "+48 min", trend: "better" }];
const itemRows: TooltipRow[] = [{ label: "Damage", value: "142" }, { label: "Crit chance", value: "+8%", trend: "better" }, { label: "Stamina use", value: "+12%", trend: "worse" }];
const bars = [40, 55, 35, 80, 60, 45, 70];
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <div class="flex h-16 items-end gap-1.5">
      <button v-for="(height, index) in bars" :key="index" class="bg-primary/30 hover:bg-primary focus-visible:bg-primary w-6 rounded-t-sm" :style="{ height: height + '%' }" :aria-label="'Day ' + (index + 1)" v-bind="tipFor('chart')" />
    </div>
    <Button variant="outline" class="size-12 text-xl" aria-label="Wolfbane Longbow" v-bind="tipFor('item')" hinted :disabled="disabled">🏹</Button>
  </div>
  <Tooltip :open="tip.open === 'chart'" :anchor="tip.anchor" side="top" title="Thursday" @dismiss="hide"><TooltipRows :rows="chartRows" /></Tooltip>
  <Tooltip :open="tip.open === 'item'" :anchor="tip.anchor" side="right" title="Wolfbane Longbow" description="Ranged · Level 25" @dismiss="hide">
    <Separator /><TooltipRows :rows="itemRows" /><Separator /><p>Arrows pierce the first enemy.</p>
  </Tooltip>
</template>
