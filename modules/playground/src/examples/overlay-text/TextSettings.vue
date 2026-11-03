<script setup lang="ts">
// The settings rows for an overlay text, for the Look page of a module's settings, with the box they change. Rows that don't
// apply to the choice above them are left out: a text that grows with its frame has nothing to scroll.
import { SettingsSection } from "@tavora/official-ui/components/ui/module-settings";
import { OVERLAY_TEXT_DEFAULTS, OverlayText, OverlayTextSettings, type OverlayTextSettingsValue } from "@tavora/official-ui/components/ui/overlay-text";
import { ref } from "vue";

const settings = ref<OverlayTextSettingsValue>({ ...OVERLAY_TEXT_DEFAULTS, mode: "fixed" });
</script>

<template>
  <div class="flex max-w-xl flex-col gap-4">
    <OverlayText v-bind="settings" align="left" :padding="8" :class="['bg-foreground text-background h-12 rounded-md', settings.mode === 'grow' ? 'w-fit' : 'w-full max-w-80']">
      <div class="font-semibold" style="font-size: calc(20px * var(--overlay-text-scale))">Now playing: The very long song name</div>
    </OverlayText>
    <SettingsSection title="Box">
      <OverlayTextSettings v-model="settings" testid="box" />
    </SettingsSection>
  </div>
</template>
