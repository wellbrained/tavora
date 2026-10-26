<script setup lang="ts">
// Counts only: no email, name or id is ever sent here.
import { Sparkline } from "@tavora/official-ui/components/ui/sparkline";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { computed, onMounted, watch } from "vue";
import { resource } from "../api";
import Fact from "../components/Fact.vue";
import Group from "../components/Group.vue";
import PageTitle from "../components/PageTitle.vue";
import { refreshTick } from "../nav";
import type { Accounts } from "../types";

const accounts = resource<Accounts>("/api/accounts");
const counts = computed(() => (accounts.data.value?.on ? accounts.data.value : null));
const lastDays = (days: number) => counts.value?.perDay.slice(-days).reduce((sum, entry) => sum + entry.count, 0) ?? 0;
const perDay = computed(() => counts.value?.perDay.map((entry) => entry.count) ?? []);

onMounted(() => void accounts.reload());
watch(refreshTick, () => void accounts.reload());
</script>

<template>
  <PageTitle title="Accounts" hint="Counts only. No emails or personal details." />
  <Notice v-if="accounts.error.value" variant="error">{{ accounts.error.value }}</Notice>
  <Notice v-if="accounts.data.value && !accounts.data.value.on" variant="info">Accounts are off on this server.</Notice>

  <template v-if="counts">
    <Group title="Accounts">
      <Fact label="In total" :value="counts.total" />
      <Fact label="New today" :value="lastDays(1)" />
      <Fact label="New in the last 7 days" :value="lastDays(7)" />
      <Fact label="New in the last 30 days" :value="lastDays(30)" />
    </Group>
    <Group title="Signed in">
      <Fact label="Used a sign-in in the last 7 days" :value="counts.active7" />
      <Fact label="Used a sign-in in the last 30 days" :value="counts.active30" />
    </Group>
    <Group title="New accounts per day" hint="The last 30 days.">
      <div class="px-3 py-3">
        <Sparkline :values="perDay" :min="0" :max="Math.max(1, ...perDay)" :height="64" label="New accounts per day over the last 30 days" />
      </div>
    </Group>
  </template>
  <p v-else-if="!accounts.data.value && !accounts.error.value" class="text-muted-foreground text-sm">Loading…</p>
</template>
