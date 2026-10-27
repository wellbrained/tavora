<script setup lang="ts">
// In the workspace header, while overlays are on in Settings (and on Windows): Overlay opens the overlay layout, and the
// Live icon next to it pauses and resumes everything over the game. Three looks: Live (something shows now), Ready (on,
// nothing shows) and Paused.
import { Circle, CirclePause, Radio } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ButtonGroup } from "@tavora/official-ui/components/ui/button-group";
import { act, state } from "../../host";
import { t } from "../../i18n";

const overlays = computed(() => state.value!.gameOverlays);
const look = computed(() => (overlays.value.hidden ? "paused" : overlays.value.showing ? "live" : "ready"));
const icons = { live: Radio, ready: Circle, paused: CirclePause };
const tint = { live: "text-success", ready: "", paused: "text-muted-foreground" };
</script>

<template>
  <ButtonGroup v-if="overlays.supported && overlays.enabled" data-testid="overlay-button">
    <Button size="sm" variant="secondary" data-testid="overlay-open" @click="act({ type: 'open-overlay-layout' })">{{ t("overlays.button.open") }}</Button>
    <Button
      size="sm"
      variant="secondary"
      :class="tint[look]"
      :title="t(`overlays.button.${look}Tip`)"
      :aria-label="t(`overlays.button.${look}Tip`)"
      :data-state="look"
      data-testid="overlay-live"
      @click="act({ type: 'set-game-overlays-hidden', hidden: !overlays.hidden })"
    >
      <component :is="icons[look]" :stroke-width="1.5" /> {{ t(`overlays.button.${look}`) }}
    </Button>
  </ButtonGroup>
</template>
