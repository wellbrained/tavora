<script setup lang="ts">
// The name of a game or folder beside its icon in the compact rail. It replaces the system's small tooltip,
// which is tiny and blurry: this one is large, high-contrast and appears at once.
//
// Module panels are views drawn above the host page, so a label over the workspace would be hidden behind them.
// While a tooltip is open it counts as an open menu: the host freezes and hides the panels, as it does for menus.
import { onBeforeUnmount } from "vue";
import { useFloating } from "../host";
import { TooltipArrow, TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from "reka-ui";

defineProps<{ text: string; disabled?: boolean }>();

const setFloating = useFloating();
let release: ReturnType<typeof setTimeout> | undefined;
/** Closing waits a moment, so moving from one icon to the next does not show and hide the panels each time. */
function onOpenChange(open: boolean) {
  clearTimeout(release);
  if (open) setFloating(true);
  else release = setTimeout(() => setFloating(false), 400);
}
onBeforeUnmount(() => clearTimeout(release));
</script>

<template>
  <TooltipRoot :disabled="disabled" @update:open="onOpenChange">
    <TooltipTrigger as-child><slot /></TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        side="right"
        :side-offset="9"
        class="bg-popover text-popover-foreground data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 z-50 max-w-80 rounded-lg border px-3.5 py-2 text-base leading-snug font-semibold tracking-normal break-words antialiased shadow-xl shadow-black/50 duration-100"
        data-testid="rail-tooltip"
      >
        {{ text }}
        <!-- A pointer from the label to its icon; its two slanted sides carry the label's border. -->
        <TooltipArrow as-child>
          <svg width="20" height="10" viewBox="0 0 20 10" aria-hidden="true" style="margin-top: -1px">
            <path d="M0 0H20L10 10Z" class="fill-popover" />
            <path d="M0 0L10 10L20 0" class="stroke-border fill-none" stroke-width="1.5" />
          </svg>
        </TooltipArrow>
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
