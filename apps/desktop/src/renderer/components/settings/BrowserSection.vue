<script setup lang="ts">
// Settings > Browser: the sites the player marked in a Browser panel's
// toolbar, and clearing what websites stored. Sites are only added from the
// toolbar, where the player is on the site; here they can be removed.
import { X } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { act, confirmAction, state, submitAction } from "../../host";
import { t } from "../../i18n";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const browser = computed(() => state.value!.library.browser);
const game = computed(() => {
  const view = state.value!;
  return view.currentGameId ? view.library.games[view.currentGameId] : undefined;
});

const LISTS = [
  {
    id: "shared" as const,
    setting: "browser-shared-sites",
    label: () => t("settings.browser-shared-sites.label"),
    description: () => t("settings.browser-shared-sites.description"),
    empty: () => t("settings.browser.sharedEmpty"),
    sites: () => browser.value.sharedSites,
  },
  {
    id: "adblock-off" as const,
    setting: "browser-adblock-off",
    label: () => t("settings.browser-adblock-off.label"),
    description: () => t("settings.browser-adblock-off.description"),
    empty: () => t("settings.browser.adblockEmpty"),
    sites: () => browser.value.adblockOff,
  },
];

function clear(scope: "game" | "shared") {
  confirmAction({
    title: scope === "game" ? (game.value ? t("settings.browser.clearGameTitle", { name: game.value.name }) : t("settings.browser.clearGameTitleFallback")) : t("settings.browser.clearSharedTitle"),
    message: scope === "game" ? t("settings.browser.clearGameMessage") : t("settings.browser.clearSharedMessage"),
    confirm: t("settings.browser.clearConfirm"),
    danger: true,
    run: () => submitAction({ type: "clear-browser-data", scope }),
  });
}
</script>

<template>
  <p class="text-muted-foreground mb-6 max-w-prose text-sm">{{ t("settings.browser.intro") }}</p>
  <SettingGroup :title="t('settings.heading.sites')">
    <div
      v-for="list in LISTS"
      :key="list.id"
      class="-mx-5 border-b px-5 py-4 transition-colors duration-500 last:border-b-0"
      :class="highlight === list.setting && 'bg-primary/10'"
      :data-setting="list.setting"
    >
      <div class="flex flex-col gap-0.5">
        <span class="font-medium">{{ list.label() }}</span>
        <span class="text-muted-foreground text-sm">{{ list.description() }}</span>
      </div>
      <p v-if="!list.sites().length" class="text-muted-foreground/80 mt-3 text-sm">{{ list.empty() }}</p>
      <ul v-else class="mt-3 flex flex-wrap gap-2" :data-testid="list.setting">
        <li v-for="site in list.sites()" :key="site" class="bg-secondary flex h-8 items-center gap-1 rounded-md pr-1 pl-3 text-sm">
          {{ site }}
          <Button variant="danger" size="icon-xs" :aria-label="t('settings.browser.removeSite', { site })" @click="act({ type: 'browser-forget-site', list: list.id, site })">
            <X :stroke-width="1.5" />
          </Button>
        </li>
      </ul>
    </div>
  </SettingGroup>
  <SettingGroup :title="t('settings.heading.browserData')">
    <SettingRow
      :label="t('settings.browser-clear-game.label')"
      :description="t('settings.browser-clear-game.description')"
      setting="browser-clear-game"
      :highlighted="highlight === 'browser-clear-game'"
    >
      <Button variant="secondary" :disabled="!game" data-testid="browser-clear-game" @click="clear('game')">{{ t("common.clear") }}</Button>
    </SettingRow>
    <SettingRow
      :label="t('settings.browser-clear-shared.label')"
      :description="t('settings.browser-clear-shared.description')"
      setting="browser-clear-shared"
      :highlighted="highlight === 'browser-clear-shared'"
    >
      <Button variant="secondary" data-testid="browser-clear-shared" @click="clear('shared')">{{ t("common.clear") }}</Button>
    </SettingRow>
  </SettingGroup>
</template>
