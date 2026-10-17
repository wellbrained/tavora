<script setup lang="ts">
// Settings > Integrations > Discord: the Discord connector. Tavora's sign-in to the Discord app on
// this PC, and the modules allowed to use it, each revocable (decision log, module grants row of
// 2026-10-16). There is no secret to enter: the main process signs in with PKCE and keeps the
// sign-in encrypted; none of it comes to this page or to a module.
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { act, confirmAction, discord, gamesUsing, listOf, state, submitAction } from "../../host";
import { t } from "../../i18n";
import ModuleIcon from "../ModuleIcon.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const view = computed(() => discord.value);

const STATUS = {
  off: "discord.status.off",
  "signed-out": "discord.status.signedOut",
  connecting: "discord.status.connecting",
  "not-running": "discord.status.notRunning",
  approving: "discord.status.approving",
} as const;
const status = computed(() => {
  const current = view.value;
  if (!current) return "";
  if (current.status === "connected") return current.user ? t("discord.status.connectedAs", { name: current.user.name }) : t("discord.status.connected");
  if (current.status === "error") return t(current.error ?? "discord.status.notConnected");
  return t(STATUS[current.status]);
});
const connected = computed(() => view.value?.status === "connected" || view.value?.status === "not-running");

type ModuleView = NonNullable<typeof state.value>["modules"][number];

/** Modules the player allowed to use Tavora's Discord sign-in. */
const users = computed(() => (state.value?.modules ?? []).filter((module) => module.permissions.granted.connectors.includes("discord")));

function revoke(module: ModuleView) {
  const games = gamesUsing(module);
  confirmAction({
    title: t("integrations.grants.revokeTitle", { name: module.name }),
    message: games.length
      ? t("integrations.grants.revokeUsed", { name: module.name, games: listOf(games) })
      : t("integrations.discord.revokeUnused", { name: module.name }),
    confirm: t("integrations.grants.revoke"),
    danger: true,
    run: () => submitAction({ type: "revoke-module", moduleId: module.id }),
  });
}
</script>

<template>
  <section>
    <h3 class="text-lg font-semibold">{{ t("integrations.discord.title") }}</h3>
    <p class="text-muted-foreground mt-1 mb-4">{{ t("discord.settings.intro") }}</p>
    <SettingRow :label="t('settings.discord-connection.label')" :description="status" setting="discord-connection" :highlighted="highlight === 'discord-connection'">
      <Button v-if="connected || view?.user" variant="secondary" data-testid="discord-sign-out" @click="act({ type: 'discord-sign-out' })">{{ t("discord.settings.signOut") }}</Button>
      <Button v-else variant="secondary" data-testid="discord-settings-connect" @click="act({ type: 'discord-connect' })">{{ t("discord.settings.connect") }}</Button>
    </SettingRow>
    <p class="text-muted-foreground mt-4 text-sm" data-testid="discord-limited">{{ t("discord.settings.limited") }}</p>
    <p v-if="view && !view.canSaveSignIn" class="text-muted-foreground mt-2 text-sm">{{ t("discord.settings.cantKeep") }}</p>

    <h4 class="mt-6 font-medium">{{ t("integrations.discord.modules") }}</h4>
    <p v-if="!users.length" class="text-muted-foreground py-2 text-sm" data-testid="discord-users-none">{{ t("integrations.discord.noModules") }}</p>
    <ul v-else class="flex flex-col" data-testid="discord-users">
      <li v-for="module in users" :key="module.id" class="flex items-center gap-3 border-b py-2 last:border-b-0" :data-testid="`discord-user-${module.id}`">
        <span class="bg-background text-primary flex size-8 flex-none items-center justify-center rounded-lg border" aria-hidden="true">
          <ModuleIcon :module-id="module.id" size="size-4" />
        </span>
        <span class="min-w-0 flex-1 truncate font-medium">{{ module.name }}</span>
        <Button variant="secondary" :aria-label="t('integrations.discord.revokeLabel', { name: module.name })" :data-testid="`discord-revoke-${module.id}`" @click="revoke(module)">
          {{ t("integrations.grants.revoke") }}
        </Button>
      </li>
    </ul>
  </section>
</template>
