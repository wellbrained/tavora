<script setup lang="ts">
// In the workspace header, while overlays are on in Settings (and on Windows): Overlay opens the Overlay page (and, on the
// page, where it stays, is lit and takes you back), and Start / Stop next to it starts and stops everything over the game.
// Running, it is green while something shows and blue while it waits for a game.
import { Play, Square } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ButtonGroup } from "@tavora/official-ui/components/ui/button-group";
import { act, state } from "../../host";
import { t } from "../../i18n";

const props = defineProps<{ active?: boolean }>();
const overlays = computed(() => state.value!.gameOverlays);
const look = computed(() => (overlays.value.hidden ? "stopped" : overlays.value.showing ? "live" : "ready"));
const tint = {
  stopped: "",
  live: "bg-success/15 text-success hover:bg-success/25 hover:text-success",
  ready: "bg-info/15 text-info hover:bg-info/25 hover:text-info",
};
const tip = { stopped: "overlays.button.startTip", live: "overlays.button.liveTip", ready: "overlays.button.readyTip" } as const;
</script>

<template>
  <ButtonGroup v-if="overlays.supported && overlays.enabled" data-testid="overlay-button">
    <Button size="sm" :variant="props.active ? 'default' : 'secondary'" :aria-pressed="props.active ? 'true' : undefined" data-testid="overlay-open" @click="act({ type: props.active ? 'leave-overlay-page' : 'open-overlay-page' })">{{ t("overlays.button.open") }}</Button>
    <Button
      size="sm"
      variant="secondary"
      class="w-20"
      :class="tint[look]"
      :title="t(tip[look])"
      :aria-label="t(tip[look])"
      :data-state="look"
      data-testid="overlay-live"
      @click="act({ type: 'set-game-overlays-hidden', hidden: !overlays.hidden })"
    >
      <component :is="overlays.hidden ? Play : Square" :stroke-width="1.5" />
      {{ t(overlays.hidden ? "overlays.button.start" : "overlays.button.stop") }}
    </Button>
  </ButtonGroup>
</template>
