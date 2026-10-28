<script setup lang="ts">
// In the workspace header, while overlays are on in Settings (and on Windows): Start / Stop for everything over the game. The way
// to the Overlay page is in the rail (RailOverlayButton.vue). Start is green, Stop is red; the tooltip says whether something shows or the overlays wait for a game.
import { Play, Square } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { act, state } from "../../host";
import { t } from "../../i18n";

const overlays = computed(() => state.value!.gameOverlays);
const look = computed(() => (overlays.value.hidden ? "stopped" : overlays.value.showing ? "live" : "ready"));
const tint = {
  stopped: "bg-success/15 text-success hover:bg-success/25 hover:text-success",
  live: "bg-destructive/15 text-destructive hover:bg-destructive/25 hover:text-destructive",
  ready: "bg-destructive/15 text-destructive hover:bg-destructive/25 hover:text-destructive",
};
const tip = { stopped: "overlays.button.startTip", live: "overlays.button.liveTip", ready: "overlays.button.readyTip" } as const;
</script>

<template>
  <Button
    v-if="overlays.supported && overlays.enabled"
    variant="secondary"
    :class="['h-9 w-24 text-[0.9375rem] [&_svg]:size-5', tint[look]]"
    :title="t(tip[look])"
    :aria-label="t(tip[look])"
    :data-state="look"
    data-testid="overlay-live"
    @click="act({ type: 'set-game-overlays-hidden', hidden: !overlays.hidden })"
  >
    <component :is="overlays.hidden ? Play : Square" class="fill-current" :stroke-width="1.5" />
    {{ t(overlays.hidden ? "overlays.button.start" : "overlays.button.stop") }}
  </Button>
</template>
