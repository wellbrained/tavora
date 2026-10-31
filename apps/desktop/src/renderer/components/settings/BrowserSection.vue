<script setup lang="ts">
// Settings > Browser: the sites the user marked in a Browser panel's
// toolbar, and clearing what websites stored. Sites are only added from the
// toolbar, where the user is on the site; here they can be removed.
import { X } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { act, confirmAction, state, submitAction } from "../../host";
import { t } from "../../i18n";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const browser = computed(() => state.value!.library.browser);
const workspace = computed(() => {
  const view = state.value!;
  return view.currentWorkspaceId ? view.library.workspaces[view.currentWorkspaceId] : undefined;
});

const LISTS = [
  {
    id: "shared" as const,
    setting: "browser-shared-sites",
    label: () => t("settings.browser-shared-sites.label"),
    description: () => t("settings.browser-shared-sites.description"),
    details: () => t("settings.browser-shared-sites.details"),
    empty: () => t("settings.browser.sharedEmpty"),
    sites: () => browser.value.sharedSites,
  },
  {
    id: "adblock-off" as const,
    setting: "browser-adblock-off",
    label: () => t("settings.browser-adblock-off.label"),
    description: () => t("settings.browser-adblock-off.description"),
    details: () => t("settings.browser-adblock-off.details"),
    empty: () => t("settings.browser.adblockEmpty"),
    sites: () => browser.value.adblockOff,
  },
];

function clear(scope: "workspace" | "shared") {
  confirmAction({
    title: scope === "workspace" ? (workspace.value ? t("settings.browser.clearWorkspaceTitle", { name: workspace.value.name }) : t("settings.browser.clearWorkspaceTitleFallback")) : t("settings.browser.clearSharedTitle"),
    message: scope === "workspace" ? t("settings.browser.clearWorkspaceMessage") : t("settings.browser.clearSharedMessage"),
    confirm: t("settings.browser.clearConfirm"),
    danger: true,
    run: () => submitAction({ type: "clear-browser-data", scope }),
  });
}
</script>

<template>
  <p class="text-muted-foreground mb-6 max-w-prose text-sm">{{ t("settings.browser.intro") }}</p>
  <SettingGroup :title="t('settings.heading.sites')">
    <SettingRow
      v-for="list in LISTS"
      :key="list.id"
      :label="list.label()"
      :description="list.description()"
      :details="list.details()"
      :setting="list.setting"
      :highlighted="highlight === list.setting"
    >
      <template #below>
        <p v-if="!list.sites().length" class="text-muted-foreground/80 mt-2 text-sm">{{ list.empty() }}</p>
        <ul v-else class="mt-2 flex flex-wrap gap-2" :data-testid="list.setting">
          <li v-for="site in list.sites()" :key="site" class="bg-secondary flex h-8 items-center gap-1 rounded-md pr-1 pl-3 text-sm">
            {{ site }}
            <Button variant="danger" size="icon-xs" :aria-label="t('settings.browser.removeSite', { site })" @click="act({ type: 'browser-forget-site', list: list.id, site })">
              <X :stroke-width="1.5" />
            </Button>
          </li>
        </ul>
      </template>
    </SettingRow>
  </SettingGroup>
  <SettingGroup :title="t('settings.heading.browserData')">
    <SettingRow
      :label="t('settings.browser-clear-workspace.label')"
      :description="t('settings.browser-clear-workspace.description')"
      setting="browser-clear-workspace"
      :highlighted="highlight === 'browser-clear-workspace'"
    >
      <Button variant="secondary" :disabled="!workspace" data-testid="browser-clear-workspace" @click="clear('workspace')">{{ t("common.clear") }}</Button>
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
