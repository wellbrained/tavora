<script setup lang="ts">
// Settings > Integrations: the apps on this PC that modules may use. Each
// integration is a group of its own; Discord is the first. Discord and AI usage
// show only once an installed module asks for them (they left Tavora as modules). Which websites
// modules may reach is in Settings > Modules, and the Steam import, which is
// Tavora's own and not a module's, is in Settings > Games.
import AiUsageSection from "./AiUsageSection.vue";
import DiscordSection from "./DiscordSection.vue";
import SystemInfoSection from "./SystemInfoSection.vue";
import MediaSection from "./MediaSection.vue";
import { hiddenSettingIds } from "../../host";

defineProps<{ highlight: string | null }>();
</script>

<template>
  <DiscordSection v-if="!hiddenSettingIds.has('discord-connection')" :highlight="highlight" />
  <AiUsageSection v-if="!hiddenSettingIds.has('ai-usage-accounts')" :highlight="highlight" />
  <SystemInfoSection />
  <MediaSection />
</template>
