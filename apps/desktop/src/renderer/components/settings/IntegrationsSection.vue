<script setup lang="ts">
// Settings > Integrations: Tavora's connections to other apps on this PC. Each
// integration is a part of this page with its own heading; Discord is the first.
import { t } from "../../i18n";
import DiscordSection from "./DiscordSection.vue";

defineProps<{ highlight: string | null }>();
</script>

<template>
  <p class="text-muted-foreground mb-6">{{ t("settings.integrations.intro") }}</p>
  <DiscordSection :highlight="highlight" />
</template>
