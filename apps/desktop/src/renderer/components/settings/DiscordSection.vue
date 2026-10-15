<script setup lang="ts">
// Settings > Discord: the Discord panel's connection to the Discord app on
// this PC, and the Client Secret of Tavora's Discord application. The secret
// is kept encrypted by the main process and never comes back to this page.
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { act, confirmAction, discord, submitAction } from "../../host";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const view = computed(() => discord.value);
const secret = ref("");
const secretError = ref<string | null>(null);

const STATUS: Record<string, string> = {
  off: "Connects when a Discord panel is open.",
  "no-secret": "Add the Client Secret below first.",
  "signed-out": "Not connected yet.",
  connecting: "Connecting…",
  "not-running": "Waiting for the Discord app to start.",
  approving: "Waiting for you to approve Tavora in Discord.",
};
const status = computed(() => {
  const current = view.value;
  if (!current) return "";
  if (current.status === "connected") return current.user ? `Connected as ${current.user.name}.` : "Connected.";
  if (current.status === "error") return current.error ?? "Not connected.";
  return STATUS[current.status] ?? "";
});
const connected = computed(() => view.value?.status === "connected" || view.value?.status === "not-running");

async function saveSecret() {
  const value = secret.value.trim();
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(value)) {
    secretError.value = "That doesn't look like a Client Secret. Copy it again from the Developer Portal.";
    return;
  }
  secretError.value = await submitAction({ type: "discord-set-secret", secret: value });
  if (!secretError.value) secret.value = "";
}

function removeSecret() {
  confirmAction({
    title: "Remove the Client Secret?",
    message: "Tavora signs out of Discord on this PC. Discord panels stay in your layouts and connect again once you add the secret.",
    confirm: "Remove",
    danger: true,
    run: () => submitAction({ type: "discord-set-secret", secret: null }),
  });
}
</script>

<template>
  <h2 class="text-xl font-semibold">Discord</h2>
  <p class="text-muted-foreground mt-2 mb-4">
    Discord panels show who is in your voice channel, who is talking and who is muted. They read this from the Discord app on this PC. Tavora can't hear, talk,
    read messages or change anything in Discord.
  </p>
  <SettingRow label="Discord connection" :description="status" setting="discord-connection" :highlighted="highlight === 'discord-connection'">
    <Button v-if="connected || view?.user" variant="secondary" data-testid="discord-sign-out" @click="act({ type: 'discord-sign-out' })">Sign out</Button>
    <Button v-else variant="secondary" :disabled="!view?.secretSaved" data-testid="discord-settings-connect" @click="act({ type: 'discord-connect' })">Connect</Button>
  </SettingRow>
  <div
    class="-mx-3 rounded-lg px-3 py-4 transition-colors duration-500"
    :class="highlight === 'discord-secret' && 'bg-primary/10'"
    data-setting="discord-secret"
  >
    <div class="flex flex-col gap-1">
      <span class="font-medium">Client Secret</span>
      <span class="text-muted-foreground">
        From Tavora's application in the Discord Developer Portal, under OAuth2. It is kept on this PC only, encrypted, and is only ever sent to Discord.
      </span>
    </div>
    <div v-if="view && !view.canSaveSecret" class="text-muted-foreground mt-3 text-sm">This PC can't keep secrets encrypted, so Tavora won't save one.</div>
    <div v-else-if="view?.secretSaved" class="mt-3 flex items-center gap-3">
      <span class="text-muted-foreground flex-1 text-sm" data-testid="discord-secret-saved">Saved on this PC.</span>
      <Button variant="secondary" data-testid="discord-remove-secret" @click="removeSecret">Remove…</Button>
    </div>
    <form v-else class="mt-3 flex items-start gap-3" @submit.prevent="saveSecret">
      <div class="flex flex-1 flex-col gap-1">
        <Input v-model="secret" type="password" autocomplete="off" spellcheck="false" placeholder="Paste the Client Secret" aria-label="Client Secret" data-testid="discord-secret" />
        <span v-if="secretError" class="text-destructive text-sm">{{ secretError }}</span>
      </div>
      <Button type="submit" :disabled="!secret.trim()">Save</Button>
    </form>
  </div>
</template>
