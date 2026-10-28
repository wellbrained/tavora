<script setup lang="ts">
// The strip along the bottom of the window, on every screen while overlays are on in Settings (and on Windows): what the
// overlays are doing, Start / Stop, and the way to the Overlay page (and back from it). It is global, so it lives outside
// the workspace header; Start is green, Stop red.
import { Play, Square } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { act, state } from "../host";
import { t } from "../i18n";

const overlays = computed(() => state.value!.gameOverlays);
const onPage = computed(() => state.value!.screen === "overlay");
const look = computed(() => (overlays.value.hidden ? "stopped" : overlays.value.showing ? "live" : "ready"));
const tint = {
  stopped: "bg-success/15 text-success hover:bg-success/25 hover:text-success",
  live: "bg-destructive/15 text-destructive hover:bg-destructive/25 hover:text-destructive",
  ready: "bg-destructive/15 text-destructive hover:bg-destructive/25 hover:text-destructive",
};
const dot = { stopped: "bg-muted-foreground/60", live: "bg-success", ready: "bg-info" };
</script>

<template>
  <div v-if="overlays.supported && overlays.enabled" class="bg-muted/40 flex h-8 flex-none items-center gap-3 border-t px-3 text-xs" data-testid="overlay-bar">
    <span class="flex min-w-0 items-center gap-2" :title="t(`overlays.bar.${look}Tip`)">
      <span :class="['size-2 flex-none rounded-full', dot[look]]" aria-hidden="true" />
      <span class="truncate">{{ t(`overlays.bar.${look}`) }}</span>
    </span>
    <Button
      size="sm"
      variant="secondary"
      :class="['h-6 w-20', tint[look]]"
      :aria-label="t(overlays.hidden ? 'overlays.button.startTip' : 'overlays.button.stopTip')"
      :data-state="look"
      data-testid="overlay-live"
      @click="act({ type: 'set-game-overlays-hidden', hidden: !overlays.hidden })"
    >
      <component :is="overlays.hidden ? Play : Square" class="fill-current" :stroke-width="1.5" />
      {{ t(overlays.hidden ? "overlays.button.start" : "overlays.button.stop") }}
    </Button>
    <span class="flex-1" />
    <Button size="sm" :variant="onPage ? 'default' : 'ghost'" class="h-6" :aria-pressed="onPage ? 'true' : undefined" data-testid="overlay-open" @click="act({ type: onPage ? 'leave-overlay-page' : 'open-overlay-page' })">
      {{ t(onPage ? "overlays.bar.back" : "overlays.bar.arrange") }}
    </Button>
  </div>
</template>
