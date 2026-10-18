<script setup lang="ts">
// Settings > Integrations: Tavora's connections to other apps on this PC. Each
// integration is a group of its own; Discord is the first. Which websites
// modules may reach is in Settings > Modules.
import AiUsageSection from "./AiUsageSection.vue";
import DiscordSection from "./DiscordSection.vue";
import SteamSection from "./SteamSection.vue";

defineProps<{ highlight: string | null }>();
</script>

<template>
  <DiscordSection :highlight="highlight" />
  <SteamSection :highlight="highlight" />
  <AiUsageSection :highlight="highlight" />
</template>
