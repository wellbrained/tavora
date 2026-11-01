<script setup lang="ts">
// The name of a workspace or folder beside its icon in the compact rail, shown with the shared kit tooltip.
//
// Module panels are views drawn above the host page, so a label over the workspace would be hidden behind them.
// While a tooltip is open it counts as an open menu: the host freezes and hides the panels, as it does for menus.
import { Tooltip, tooltipDelay } from "@tavora/official-ui/components/tooltip";
import { onBeforeUnmount, ref, watch } from "vue";
import { t } from "../i18n";
import { useFloating } from "../host";

const props = defineProps<{
  text: string;
  disabled?: boolean;
  /** A folder: `lines` are the workspaces inside it. */
  folder?: boolean;
  lines?: string[];
  /** How many more workspaces the folder holds than `lines` lists. */
  more?: number;
  /** A short second line in quieter text, such as what a click does. */
  hint?: string;
}>();

const open = ref(false);
const anchor = ref({ left: 0, top: 0, right: 0, bottom: 0 });
const setFloating = useFloating();
let delay: ReturnType<typeof setTimeout> | undefined;
let release: ReturnType<typeof setTimeout> | undefined;

function show(trigger: Element | null) {
  if (props.disabled || !trigger || open.value) return;
  clearTimeout(delay);
  delay = setTimeout(() => {
    // Beside the icon, its arrow on the icon's middle.
    const { left, top, right, bottom } = trigger.getBoundingClientRect();
    anchor.value = { left, top, right, bottom };
    clearTimeout(release);
    setFloating(true);
    open.value = true;
  }, tooltipDelay(150));
}
/** Closing waits a moment, so moving from one icon to the next does not show and hide the panels each time. */
function hide() {
  clearTimeout(delay);
  if (!open.value) return;
  open.value = false;
  release = setTimeout(() => setFloating(false), 400);
}
function leave(event: PointerEvent | FocusEvent) {
  const wrapper = event.currentTarget as HTMLElement;
  if (!(event.relatedTarget instanceof Node && wrapper.contains(event.relatedTarget))) hide();
}
function focus(event: FocusEvent) {
  if ((event.target as Element).matches(":focus-visible")) show((event.currentTarget as HTMLElement).firstElementChild);
}
watch(() => props.disabled, (disabled) => disabled && hide());
onBeforeUnmount(() => {
  clearTimeout(delay);
  clearTimeout(release);
});
</script>

<template>
  <span
    class="contents"
    @pointerover="show(($event.currentTarget as HTMLElement).firstElementChild)"
    @pointerout="leave"
    @pointerdown="hide"
    @focusin="focus"
    @focusout="leave"
  >
    <slot />
    <Tooltip compact side="right" :open="open" :anchor="anchor" :title="text" :description="hint" @dismiss="hide">
      <ul v-if="folder" class="rail-tooltip-workspaces" data-testid="rail-tooltip-workspaces">
        <li v-for="line in lines" :key="line" class="truncate">{{ line }}</li>
        <li v-if="more">{{ t("rail.folderMore", { count: more }) }}</li>
        <li v-if="!lines?.length">{{ t("rail.emptyFolder") }}</li>
      </ul>
    </Tooltip>
  </span>
</template>

<style scoped>
.rail-tooltip-workspaces {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  color: var(--muted-foreground);
}
</style>
