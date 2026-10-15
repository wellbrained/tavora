<script setup lang="ts">
// The name of a game or folder beside its icon in the compact rail. It replaces the system's small tooltip,
// which is tiny and blurry: this one is large, high-contrast and appears at once.
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from "reka-ui";

defineProps<{ text: string; disabled?: boolean }>();
</script>

<template>
  <TooltipRoot :disabled="disabled">
    <TooltipTrigger as-child><slot /></TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        side="right"
        :side-offset="14"
        class="bg-popover text-popover-foreground data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 z-50 max-w-80 rounded-lg border px-3.5 py-2 text-base leading-snug font-semibold tracking-normal break-words antialiased shadow-xl shadow-black/50 duration-100"
        data-testid="rail-tooltip"
      >
        {{ text }}
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
