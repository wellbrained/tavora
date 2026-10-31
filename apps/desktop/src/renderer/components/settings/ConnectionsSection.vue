<script setup lang="ts">
// Settings > Connections: everything a module may reach outside its panel, one row each: websites, Discord, the AI
// accounts, system info, media and leaderboards. A row says how much it is used; opened, it lists the modules
// allowed to use it, each with Take back, and what there is to set up. Discord, AI accounts and Leaderboards show
// only once an installed module asks for them (hiddenSettingIds). A search result opens its row.
import { Cpu, Globe, Headphones, Music, Sparkles, Trophy } from "@lucide/vue";
import { computed, reactive, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { account, act, aiUsage, confirmAction, discord, hiddenSettingIds, state, submitAction } from "../../host";
import { t } from "../../i18n";
import ModuleIcon from "../ModuleIcon.vue";
import AiUsageAccounts from "./AiUsageAccounts.vue";
import GrantedModules from "./GrantedModules.vue";
import { revokeModule, type ModuleView } from "./grants";
import SettingExpand from "./SettingExpand.vue";
import SettingGroup from "./SettingGroup.vue";

const props = defineProps<{ highlight: string | null }>();

const modules = computed(() => state.value?.modules ?? []);
const granted = (connector: string) => modules.value.filter((module) => module.permissions.granted.connectors.includes(connector as never)).length;

/** The rows opened; a search result opens its own. */
const open = reactive<Record<string, boolean>>({});
watch(
  () => props.highlight,
  (setting) => {
    if (setting) open[setting] = true;
  },
  { immediate: true },
);

/** How many modules may use it, or that none may yet. */
const usedBy = (count: number) => (count ? t("connections.usedBy", { count }) : t("connections.unused"));

const websites = computed(() => modules.value.filter((module) => module.permissions.granted.network.length > 0).length);

const DISCORD_STATUS = {
  off: "discord.status.off",
  "signed-out": "discord.status.signedOut",
  connecting: "discord.status.connecting",
  "not-running": "discord.status.notRunning",
  approving: "discord.status.approving",
} as const;
const discordStatus = computed(() => {
  const current = discord.value;
  if (!current) return "";
  if (current.status === "connected") return current.user ? t("discord.status.connectedAs", { name: current.user.name }) : t("discord.status.connected");
  if (current.status === "error") return t(current.error ?? "discord.status.notConnected");
  return t(DISCORD_STATUS[current.status]);
});
const discordOn = computed(() => discord.value?.status === "connected" || discord.value?.status === "not-running");

const aiAccounts = computed(() => aiUsage.value?.accounts.length ?? 0);

/** Installed modules that offer leaderboards, granted or not. */
const boards = computed(() => modules.value.filter((module) => module.permissions.asks.connectors.includes("leaderboards")));
const boardsGranted = (module: ModuleView) => module.permissions.granted.connectors.includes("leaderboards");
const signedIn = computed(() => account.value?.account != null);

function leaveBoards(module: ModuleView) {
  confirmAction({
    title: t("integrations.leaderboards.leaveTitle", { name: module.name }),
    message: t("integrations.leaderboards.leaveText", { name: module.name }),
    confirm: t("integrations.leaderboards.leave"),
    danger: true,
    run: () => submitAction({ type: "leaderboards-hide", moduleId: module.id }),
  });
}
</script>

<template>
  <p class="text-muted-foreground mb-6 text-sm">{{ t("connections.intro") }}</p>
  <SettingGroup>
    <SettingExpand
      v-model:open="open['module-grants']"
      :label="t('settings.module-grants.label')"
      :description="websites ? t('connections.websites', { count: websites }) : t('connections.unused')"
      :details="t('settings.module-grants.description')"
      setting="module-grants"
      :highlighted="highlight === 'module-grants'"
      testid="connection-websites"
    >
      <template #lead><span class="module-tile size-9" aria-hidden="true"><Globe class="size-4" :stroke-width="1.75" /></span></template>
      <GrantedModules uses="network" :none="t('integrations.grants.none')" revoke-label="integrations.grants.revokeLabel" revoke-unused="integrations.grants.revokeUnused" testid="module-grant" />
    </SettingExpand>

    <SettingExpand
      v-if="!hiddenSettingIds.has('discord-connection')"
      v-model:open="open['discord-connection']"
      :label="t('integrations.discord.title')"
      :description="discordStatus"
      :details="t('discord.settings.intro')"
      setting="discord-connection"
      :highlighted="highlight === 'discord-connection'"
      testid="connection-discord"
    >
      <template #lead><span class="module-tile size-9" aria-hidden="true"><Headphones class="size-4" :stroke-width="1.75" /></span></template>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-dashed py-2">
        <span class="flex min-w-0 flex-1 basis-56 flex-col">
          <span class="font-medium">{{ t("settings.discord-connection.label") }}</span>
          <span class="text-muted-foreground/80 text-xs" data-testid="discord-limited">{{ t("discord.settings.limited") }}</span>
          <span v-if="discord && !discord.canSaveSignIn" class="text-muted-foreground/80 text-xs">{{ t("discord.settings.cantKeep") }}</span>
        </span>
        <Button v-if="discordOn || discord?.user" variant="secondary" size="sm" data-testid="discord-sign-out" @click="act({ type: 'discord-sign-out' })">{{ t("discord.settings.signOut") }}</Button>
        <Button v-else variant="secondary" size="sm" data-testid="discord-settings-connect" @click="act({ type: 'discord-connect' })">{{ t("discord.settings.connect") }}</Button>
      </div>
      <GrantedModules
        uses="discord"
        :heading="t('integrations.discord.modules')"
        :none="t('integrations.discord.noModules')"
        revoke-label="integrations.discord.revokeLabel"
        revoke-unused="integrations.discord.revokeUnused"
        testid="discord"
      />
    </SettingExpand>

    <SettingExpand
      v-if="!hiddenSettingIds.has('ai-usage-accounts')"
      v-model:open="open['ai-usage-accounts']"
      :label="t('settings.ai-usage-accounts.label')"
      :description="`${aiAccounts ? t('connections.aiAccounts', { count: aiAccounts }) : t('aiUsage.settings.empty')} · ${usedBy(granted('ai-usage'))}`"
      :details="t('aiUsage.settings.intro')"
      setting="ai-usage-accounts"
      :highlighted="highlight === 'ai-usage-accounts'"
      testid="connection-ai-usage"
    >
      <template #lead><span class="module-tile size-9" aria-hidden="true"><Sparkles class="size-4" :stroke-width="1.75" /></span></template>
      <AiUsageAccounts />
      <GrantedModules
        uses="ai-usage"
        :heading="t('integrations.aiUsage.modules')"
        :none="t('integrations.aiUsage.noModules')"
        revoke-label="integrations.aiUsage.revokeLabel"
        revoke-unused="integrations.aiUsage.revokeUnused"
        testid="ai-usage"
      />
    </SettingExpand>

    <SettingExpand
      v-model:open="open['system-info']"
      :label="t('integrations.systemInfo.title')"
      :description="usedBy(granted('system-info'))"
      :details="t('integrations.systemInfo.intro')"
      setting="system-info"
      :highlighted="highlight === 'system-info'"
      testid="connection-system-info"
    >
      <template #lead><span class="module-tile size-9" aria-hidden="true"><Cpu class="size-4" :stroke-width="1.75" /></span></template>
      <GrantedModules
        uses="system-info"
        :none="t('integrations.systemInfo.noModules')"
        revoke-label="integrations.systemInfo.revokeLabel"
        revoke-unused="integrations.systemInfo.revokeUnused"
        testid="system-info"
      />
    </SettingExpand>

    <SettingExpand
      v-model:open="open.media"
      :label="t('integrations.media.title')"
      :description="usedBy(granted('media'))"
      :details="t('integrations.media.intro')"
      setting="media"
      :highlighted="highlight === 'media'"
      testid="connection-media"
    >
      <template #lead><span class="module-tile size-9" aria-hidden="true"><Music class="size-4" :stroke-width="1.75" /></span></template>
      <GrantedModules uses="media" :none="t('integrations.media.noModules')" revoke-label="integrations.media.revokeLabel" revoke-unused="integrations.media.revokeUnused" testid="media" />
    </SettingExpand>

    <!-- Every module that offers boards, granted or not: Leave works without the grant, so it never depends on the
         module offering it (decided 2026-10-28: leaving deletes the user's results for that module). -->
    <SettingExpand
      v-if="!hiddenSettingIds.has('leaderboards')"
      v-model:open="open.leaderboards"
      :label="t('integrations.leaderboards.title')"
      :description="t('connections.leaderboards', { count: boards.length })"
      :details="t('integrations.leaderboards.intro')"
      setting="leaderboards"
      :highlighted="highlight === 'leaderboards'"
      testid="connection-leaderboards"
    >
      <template #lead><span class="module-tile size-9" aria-hidden="true"><Trophy class="size-4" :stroke-width="1.75" /></span></template>
      <ul class="flex flex-col py-2" data-testid="leaderboards-users">
        <li v-for="module in boards" :key="module.id" class="flex items-center gap-3 border-b border-dashed py-2 last:border-b-0" :data-testid="`leaderboards-user-${module.id}`">
          <span class="module-tile size-8" aria-hidden="true">
            <ModuleIcon :module-id="module.id" size="size-4" />
          </span>
          <span class="min-w-0 flex-1 truncate font-medium">{{ module.name }}</span>
          <Button
            v-if="signedIn"
            variant="outline"
            size="sm"
            :aria-label="t('integrations.leaderboards.leaveLabel', { name: module.name })"
            :data-testid="`leaderboards-leave-${module.id}`"
            @click="leaveBoards(module)"
          >
            {{ t("integrations.leaderboards.leave") }}
          </Button>
          <Button
            v-if="boardsGranted(module)"
            variant="danger"
            size="sm"
            :aria-label="t('integrations.leaderboards.revokeLabel', { name: module.name })"
            :data-testid="`leaderboards-revoke-${module.id}`"
            @click="revokeModule(module, 'integrations.leaderboards.revokeUnused')"
          >
            {{ t("integrations.grants.revoke") }}
          </Button>
        </li>
      </ul>
    </SettingExpand>
  </SettingGroup>
</template>
