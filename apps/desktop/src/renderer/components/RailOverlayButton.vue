<script setup lang="ts">
// In the rail above the profile, while overlays are on in Settings (and on Windows): opens the Overlay page, and on the page
// it is lit and takes you back. Start / Stop is in the workspace header (OverlayButton.vue).
import { Layers } from "@lucide/vue";
import { computed } from "vue";
import { cn } from "@/lib/utils";
import { act, state } from "../host";
import { t } from "../i18n";
import RailFooterTile from "./RailFooterTile.vue";
import RailTooltip from "./RailTooltip.vue";

defineProps<{ expanded: boolean }>();

const overlays = computed(() => state.value!.gameOverlays);
const active = computed(() => state.value!.screen === "overlay");
</script>

<template>
  <RailTooltip v-if="overlays.supported && overlays.enabled" :text="t('overlays.button.open')" :hint="t('overlays.rail.hint')" :disabled="expanded">
    <button
      type="button"
      :class="cn('group text-muted-foreground hover:text-foreground mx-2 flex items-center gap-3 rounded-lg p-1 transition-colors focus-visible:-outline-offset-2', expanded && 'hover:bg-accent', active && 'text-foreground')"
      data-rail-item
      data-testid="overlay-open"
      :aria-label="t('overlays.button.open')"
      :aria-pressed="active ? 'true' : undefined"
      @click="act({ type: active ? 'leave-overlay-page' : 'open-overlay-page' })"
    >
      <RailFooterTile :class="active && 'bg-primary text-primary-foreground'">
        <Layers class="size-5" :stroke-width="1.5" />
      </RailFooterTile>
      <span v-if="expanded" class="text-sm font-medium">{{ t("overlays.button.open") }}</span>
    </button>
  </RailTooltip>
</template>
