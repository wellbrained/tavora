<script setup lang="ts">
// A rich tooltip is shown by the module: it says which one is open and the box of the element it is for. `hinted`
// tells the button that a tooltip is shown for it.
import { CircleHelp } from "@lucide/vue";
import { Tooltip } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ref } from "vue";

const tip = ref<{ open: string | null; anchor: { left: number; top: number; right: number; bottom: number } }>({ open: null, anchor: { left: 0, top: 0, right: 0, bottom: 0 } });
function show(name: string, event: Event) {
  const { left, top, right, bottom } = (event.currentTarget as HTMLElement).getBoundingClientRect();
  tip.value = { open: name, anchor: { left, top, right, bottom } };
}
const hide = () => (tip.value.open = null);
const tipFor = (name: string) => ({ onPointerenter: (e: Event) => show(name, e), onPointerleave: hide, onFocus: (e: Event) => show(name, e), onBlur: hide });
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="ghost" size="icon-sm" aria-label="About starting with Windows" v-bind="tipFor('help')" hinted><CircleHelp :stroke-width="1.5" /></Button>
    <Button variant="secondary" v-bind="tipFor('rich')" hinted>Rich tooltip</Button>
    <Button variant="outline" class="text-warning" v-bind="tipFor('warning')" hinted>92% used</Button>
  </div>
  <Tooltip :open="tip.open === 'help'" :anchor="tip.anchor" title="Start with Windows" description="Tavora opens quietly in the tray when you sign in. Your overlays are ready when the game starts." @dismiss="hide" />
  <Tooltip :open="tip.open === 'rich'" :anchor="tip.anchor" title="A place worth exploring" shortcut="Ctrl+K" description="Readable text that wraps in narrow panels." @dismiss="hide" />
  <Tooltip :open="tip.open === 'warning'" :anchor="tip.anchor" tone="warning" title="Almost at your limit" description="Resets Friday at 09:00. You can still use 8% this week." @dismiss="hide" />
</template>
