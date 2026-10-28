<script setup lang="ts">
// In the workspace header, while overlays are on in Settings (and on Windows): Overlay opens the Overlay page (and, on the
// page, where it stays, is lit and takes you back), and the
// Live icon next to it pauses and resumes everything over the game. Three looks: Live (something shows now), Ready (on,
// nothing shows) and Paused.
import { CircleCheck, CirclePause, Radio } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ButtonGroup } from "@tavora/official-ui/components/ui/button-group";
import { act, state } from "../../host";
import { t } from "../../i18n";

const props = defineProps<{ active?: boolean }>();
const overlays = computed(() => state.value!.gameOverlays);
const look = computed(() => (overlays.value.hidden ? "paused" : overlays.value.showing ? "live" : "ready"));
// Each state has its own icon and colour: Live (green, on air), Ready (blue, on and waiting), Paused (yellow, held back).
const icons = { live: Radio, ready: CircleCheck, paused: CirclePause };
const tint = {
  live: "bg-success/15 text-success hover:bg-success/25 hover:text-success",
  ready: "bg-info/15 text-info hover:bg-info/25 hover:text-info",
  paused: "bg-warning/15 text-warning hover:bg-warning/25 hover:text-warning",
};
</script>

<template>
  <ButtonGroup v-if="overlays.supported && overlays.enabled" data-testid="overlay-button">
    <Button size="sm" :variant="props.active ? 'default' : 'secondary'" :aria-pressed="props.active ? 'true' : undefined" data-testid="overlay-open" @click="act({ type: props.active ? 'leave-overlay-page' : 'open-overlay-page' })">{{ t("overlays.button.open") }}</Button>
    <Button
      size="icon-sm"
      variant="secondary"
      :class="tint[look]"
      :title="t(`overlays.button.${look}Tip`)"
      :aria-label="t(`overlays.button.${look}Tip`)"
      :data-state="look"
      data-testid="overlay-live"
      @click="act({ type: 'set-game-overlays-hidden', hidden: !overlays.hidden })"
    >
      <component :is="icons[look]" :stroke-width="1.5" />
    </Button>
  </ButtonGroup>
</template>
