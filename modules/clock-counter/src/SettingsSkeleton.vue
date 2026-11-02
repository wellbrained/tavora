<script setup lang="ts">
// The settings of an item before they can draw: the real layout (menu, a page with its rows, the footer) as muted bars, so the dialog
// is never an empty frame while the panel starts and loads the list. It goes when the settings are ready (the page then fades in over it).
import { Hash, Keyboard, Paintbrush, Type } from "@lucide/vue";
import { Input } from "@tavora/official-ui/components/ui/input";
import { ModuleSettings, SettingsPage, SettingsRow, SettingsSection, settingsMenu } from "@tavora/official-ui/components/ui/module-settings";
import { Skeleton, placeholderText } from "@tavora/official-ui/components/ui/skeleton";
import { ref } from "vue";
import { t } from "./i18n";

const page = ref("item");
// The shape of the real menu; the words are made up and never seen.
const groups = settingsMenu({
  pages: [
    { id: "item", label: placeholderText(8), icon: Hash },
    { id: "hotkeys", label: placeholderText(8), icon: Keyboard },
  ],
  look: [
    { id: "text", label: placeholderText(6), icon: Type },
    { id: "look", label: placeholderText(6), icon: Paintbrush },
  ],
  inGame: { id: "game", on: false },
  onStream: { id: "stream", on: false },
});
const rows = [placeholderText(10), placeholderText(8), placeholderText(10), placeholderText(14), placeholderText(10)];
</script>

<template>
  <div class="h-full" data-testid="settings-skeleton">
    <span class="sr-only" role="status">{{ t("loading") }}</span>
    <!-- No delay: the dialog's frame is on screen already, so the placeholder is too. -->
    <Skeleton :loading="true" :delay="0" class="h-full">
      <ModuleSettings v-model:page="page" :groups="groups" :label="placeholderText(8)">
        <SettingsPage :title="placeholderText(12)" :description="placeholderText(20)">
          <SettingsSection>
            <SettingsRow v-for="(row, index) in rows" :key="index" :label="row" :hint="placeholderText(30)">
              <Input model-value="" class="w-full" tabindex="-1" />
            </SettingsRow>
          </SettingsSection>
        </SettingsPage>
      </ModuleSettings>
    </Skeleton>
  </div>
</template>
