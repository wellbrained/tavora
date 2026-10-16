<script setup lang="ts">
// Settings > Discord: the Discord panel's connection to the Discord app on
// this PC. There is no secret to enter: the main process signs in with PKCE
// and keeps the sign-in encrypted; none of it comes to this page.
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { act, discord } from "../../host";
import { t } from "../../i18n";
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
</script>

<template>
  <h3 class="text-lg font-semibold">{{ t("integrations.discord.title") }}</h3>
  <p class="text-muted-foreground mt-1 mb-4">{{ t("discord.settings.intro") }}</p>
  <SettingRow :label="t('settings.discord-connection.label')" :description="status" setting="discord-connection" :highlighted="highlight === 'discord-connection'">
    <Button v-if="connected || view?.user" variant="secondary" data-testid="discord-sign-out" @click="act({ type: 'discord-sign-out' })">{{ t("discord.settings.signOut") }}</Button>
    <Button v-else variant="secondary" data-testid="discord-settings-connect" @click="act({ type: 'discord-connect' })">{{ t("discord.settings.connect") }}</Button>
  </SettingRow>
  <p class="text-muted-foreground mt-4 text-sm" data-testid="discord-limited">{{ t("discord.settings.limited") }}</p>
  <p v-if="view && !view.canSaveSignIn" class="text-muted-foreground mt-2 text-sm">{{ t("discord.settings.cantKeep") }}</p>
</template>
