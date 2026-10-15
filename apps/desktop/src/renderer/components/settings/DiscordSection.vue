<script setup lang="ts">
// Settings > Discord: the Discord panel's connection to the Discord app on
// this PC, and the Client Secret of Tavora's Discord application. The secret
// is kept encrypted by the main process and never comes back to this page.
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { act, confirmAction, discord, submitAction } from "../../host";
import { t } from "../../i18n";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const view = computed(() => discord.value);
const secret = ref("");
const secretError = ref<string | null>(null);

const STATUS = {
  off: "discord.status.off",
  "no-secret": "discord.status.noSecret",
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

async function saveSecret() {
  const value = secret.value.trim();
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(value)) {
    secretError.value = t("discord.settings.invalidSecret");
    return;
  }
  secretError.value = await submitAction({ type: "discord-set-secret", secret: value });
  if (!secretError.value) secret.value = "";
}

function removeSecret() {
  confirmAction({
    title: t("discord.settings.removeTitle"),
    message: t("discord.settings.removeMessage"),
    confirm: t("discord.settings.removeConfirm"),
    danger: true,
    run: () => submitAction({ type: "discord-set-secret", secret: null }),
  });
}
</script>

<template>
  <h3 class="text-lg font-semibold">{{ t("integrations.discord.title") }}</h3>
  <p class="text-muted-foreground mt-1 mb-4">{{ t("discord.settings.intro") }}</p>
  <SettingRow :label="t('settings.discord-connection.label')" :description="status" setting="discord-connection" :highlighted="highlight === 'discord-connection'">
    <Button v-if="connected || view?.user" variant="secondary" data-testid="discord-sign-out" @click="act({ type: 'discord-sign-out' })">{{ t("discord.settings.signOut") }}</Button>
    <Button v-else variant="secondary" :disabled="!view?.secretSaved" data-testid="discord-settings-connect" @click="act({ type: 'discord-connect' })">{{ t("discord.settings.connect") }}</Button>
  </SettingRow>
  <div
    class="-mx-3 rounded-lg px-3 py-4 transition-colors duration-500"
    :class="highlight === 'discord-secret' && 'bg-primary/10'"
    data-setting="discord-secret"
  >
    <div class="flex flex-col gap-1">
      <span class="font-medium">{{ t("settings.discord-secret.label") }}</span>
      <span class="text-muted-foreground">{{ t("discord.settings.secretHelp") }}</span>
    </div>
    <div v-if="view && !view.canSaveSecret" class="text-muted-foreground mt-3 text-sm">{{ t("discord.settings.cantKeep") }}</div>
    <div v-else-if="view?.secretSaved" class="mt-3 flex items-center gap-3">
      <span class="text-muted-foreground flex-1 text-sm" data-testid="discord-secret-saved">{{ t("discord.settings.saved") }}</span>
      <Button variant="secondary" data-testid="discord-remove-secret" @click="removeSecret">{{ t("discord.settings.remove") }}</Button>
    </div>
    <form v-else class="mt-3 flex items-start gap-3" @submit.prevent="saveSecret">
      <div class="flex flex-1 flex-col gap-1">
        <Input v-model="secret" type="password" autocomplete="off" spellcheck="false" :placeholder="t('discord.settings.placeholder')" :aria-label="t('settings.discord-secret.label')" data-testid="discord-secret" />
        <span v-if="secretError" class="text-destructive text-sm">{{ secretError }}</span>
      </div>
      <Button type="submit" :disabled="!secret.trim()">{{ t("discord.settings.save") }}</Button>
    </form>
  </div>
</template>
