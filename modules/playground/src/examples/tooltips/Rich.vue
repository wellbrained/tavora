<script setup lang="ts">
import { CircleHelp } from "@lucide/vue";
import { Tooltip } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
/** Which tooltip is open, and the box of the thing it is for. */
const tip = ref<{ open: string | null; anchor: { left: number; top: number; right: number; bottom: number } }>({ open: null, anchor: { left: 0, top: 0, right: 0, bottom: 0 } });
function showTip(name: string, e: Event) {
  const { left, top, right, bottom } = (e.currentTarget as HTMLElement).getBoundingClientRect();
  tip.value = { open: name, anchor: { left, top, right, bottom } };
}
const hideTip = () => (tip.value.open = null);
const tipOn = (name: string) => ({ onPointerenter: (e: Event) => showTip(name, e), onPointerleave: hideTip, onFocus: (e: Event) => showTip(name, e), onBlur: hideTip });
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="ghost" size="icon-sm" aria-label="About starting with Windows" v-bind="tipOn('help')" hinted :disabled="off"><CircleHelp :stroke-width="1.5" /></Button>
    <Button variant="secondary" v-bind="tipOn('rich')" hinted :disabled="off">Rich tooltip</Button>
    <Button variant="outline" class="text-warning" v-bind="tipOn('warning')" hinted :disabled="off">92% used</Button>
  </div>
  <Tooltip :open="tip.open === 'help'" :anchor="tip.anchor" title="Start with Windows" description="Tavora opens quietly in the tray when you sign in. Your overlays are ready when the game starts." @dismiss="hideTip" />
  <Tooltip :open="tip.open === 'rich'" :anchor="tip.anchor" title="A place worth exploring" shortcut="Ctrl+K" description="Readable text that wraps in narrow panels." @dismiss="hideTip" />
  <Tooltip :open="tip.open === 'warning'" :anchor="tip.anchor" tone="warning" title="Almost at your limit" description="Resets Friday at 09:00. You can still use 8% this week." @dismiss="hideTip" />
</template>
