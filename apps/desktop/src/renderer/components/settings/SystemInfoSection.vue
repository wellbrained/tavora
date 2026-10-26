<script setup lang="ts">
// Settings > Integrations > System info: the system-info connector. Modules it is granted to read this PC's
// hardware and how busy it is, only while one of their panels is shown. There is nothing to set up here, so
// this lists the modules allowed to use it, each revocable (decision log, module grants row of 2026-10-16).
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { confirmAction, gamesUsing, listOf, state, submitAction } from "../../host";
import { t } from "../../i18n";
import ModuleIcon from "../ModuleIcon.vue";
import SettingGroup from "./SettingGroup.vue";

type ModuleView = NonNullable<typeof state.value>["modules"][number];

/** Modules the player allowed to see this PC's hardware and usage. */
const users = computed(() => (state.value?.modules ?? []).filter((module) => module.permissions.granted.connectors.includes("system-info")));

function revoke(module: ModuleView) {
  const games = gamesUsing(module);
  confirmAction({
    title: t("integrations.grants.revokeTitle", { name: module.name }),
    message: games.length
      ? t("integrations.grants.revokeUsed", { name: module.name, games: listOf(games) })
      : t("integrations.systemInfo.revokeUnused", { name: module.name }),
    confirm: t("integrations.grants.revoke"),
    danger: true,
    run: () => submitAction({ type: "revoke-module", moduleId: module.id }),
  });
}
</script>

<template>
  <SettingGroup :title="t('integrations.systemInfo.title')" :description="t('integrations.systemInfo.intro')">
    <div class="py-4">
      <p class="font-medium">{{ t("integrations.systemInfo.modules") }}</p>
      <p v-if="!users.length" class="text-muted-foreground pt-1 text-sm" data-testid="system-info-users-none">{{ t("integrations.systemInfo.noModules") }}</p>
      <ul v-else class="mt-1 flex flex-col" data-testid="system-info-users">
        <li v-for="module in users" :key="module.id" class="flex items-center gap-3 border-b py-2 last:border-b-0" :data-testid="`system-info-user-${module.id}`">
          <span class="module-tile size-8" aria-hidden="true">
            <ModuleIcon :module-id="module.id" size="size-4" />
          </span>
          <span class="min-w-0 flex-1 truncate font-medium">{{ module.name }}</span>
          <Button variant="danger" :aria-label="t('integrations.systemInfo.revokeLabel', { name: module.name })" :data-testid="`system-info-revoke-${module.id}`" @click="revoke(module)">
            {{ t("integrations.grants.revoke") }}
          </Button>
        </li>
      </ul>
    </div>
  </SettingGroup>
</template>
