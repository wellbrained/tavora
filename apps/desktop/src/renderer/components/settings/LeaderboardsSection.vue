<script setup lang="ts">
// Settings > Integrations > Leaderboards: the leaderboards connector (main/leaderboards.ts). It lists the installed
// modules that offer leaderboards; a granted one can be revoked like the other connectors. Signed in, each can also
// take the user off its boards here, also after a revoke, so that never depends on the module offering it (decided
// 2026-10-28: switching it off deletes the user's results for that module). Only shown once a module asks for it.
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { account, confirmAction, listOf, state, submitAction, workspacesUsing } from "../../host";
import { t } from "../../i18n";
import ModuleIcon from "../ModuleIcon.vue";
import SettingGroup from "./SettingGroup.vue";

type ModuleView = NonNullable<typeof state.value>["modules"][number];

/** Installed modules that offer leaderboards, granted or not. */
const users = computed(() => (state.value?.modules ?? []).filter((module) => module.permissions.asks.connectors.includes("leaderboards")));
const granted = (module: ModuleView) => module.permissions.granted.connectors.includes("leaderboards");
const signedIn = computed(() => account.value?.account != null);

function leave(module: ModuleView) {
  confirmAction({
    title: t("integrations.leaderboards.leaveTitle", { name: module.name }),
    message: t("integrations.leaderboards.leaveText", { name: module.name }),
    confirm: t("integrations.leaderboards.leave"),
    danger: true,
    run: () => submitAction({ type: "leaderboards-hide", moduleId: module.id }),
  });
}

function revoke(module: ModuleView) {
  const workspaces = workspacesUsing(module);
  confirmAction({
    title: t("integrations.grants.revokeTitle", { name: module.name }),
    message: workspaces.length
      ? t("integrations.grants.revokeUsed", { name: module.name, workspaces: listOf(workspaces) })
      : t("integrations.leaderboards.revokeUnused", { name: module.name }),
    confirm: t("integrations.grants.revoke"),
    danger: true,
    run: () => submitAction({ type: "revoke-module", moduleId: module.id }),
  });
}
</script>

<template>
  <SettingGroup v-if="users.length" :title="t('integrations.leaderboards.title')" :description="t('integrations.leaderboards.intro')">
    <div class="py-4">
      <p class="font-medium">{{ t("integrations.leaderboards.modules") }}</p>
      <ul class="mt-1 flex flex-col" data-testid="leaderboards-users">
        <li v-for="module in users" :key="module.id" class="flex items-center gap-3 border-b py-2 last:border-b-0" :data-testid="`leaderboards-user-${module.id}`">
          <span class="bg-background text-primary flex size-8 flex-none items-center justify-center rounded-lg border" aria-hidden="true">
            <ModuleIcon :module-id="module.id" size="size-4" />
          </span>
          <span class="min-w-0 flex-1 truncate font-medium">{{ module.name }}</span>
          <Button
            v-if="signedIn"
            variant="outline"
            :aria-label="t('integrations.leaderboards.leaveLabel', { name: module.name })"
            :data-testid="`leaderboards-leave-${module.id}`"
            @click="leave(module)"
          >
            {{ t("integrations.leaderboards.leave") }}
          </Button>
          <Button v-if="granted(module)" variant="danger" :aria-label="t('integrations.leaderboards.revokeLabel', { name: module.name })" :data-testid="`leaderboards-revoke-${module.id}`" @click="revoke(module)">
            {{ t("integrations.grants.revoke") }}
          </Button>
        </li>
      </ul>
    </div>
  </SettingGroup>
</template>
