<script setup lang="ts">
import { CircleCheck } from "@lucide/vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import { computed, onMounted, watch } from "vue";
import Fact from "../components/Fact.vue";
import Group from "../components/Group.vue";
import Line from "../components/Line.vue";
import PageTitle from "../components/PageTitle.vue";
import { bytes } from "../format";
import { go, refreshTick, summary } from "../nav";

// "Waiting for you" is a list of kinds the API sends; a new kind there shows up here without changes.
const waiting = computed(() => (summary.data.value?.waiting ?? []).filter((kind) => kind.count > 0));
const numbers = computed(() => summary.data.value?.numbers);

onMounted(() => void summary.reload());
watch(refreshTick, () => void summary.reload());
</script>

<template>
  <PageTitle title="Overview" hint="Everything around Tavora at a glance." />

  <Group title="Waiting for you">
    <Line v-for="kind in waiting" :key="kind.id" :title="kind.label">
      <template #badges><Badge variant="default">{{ kind.count }}</Badge></template>
      <template #actions><Button type="button" size="sm" variant="secondary" @click="go(kind.section, kind.tab)">Open</Button></template>
    </Line>
    <EmptyState v-if="summary.data.value && waiting.length === 0" class="m-3" title="All clear" description="Nothing is waiting for you.">
      <template #icon><CircleCheck /></template>
    </EmptyState>
    <p v-if="!summary.data.value" class="text-muted-foreground px-3 py-3 text-sm">Loading…</p>
  </Group>

  <Group v-if="numbers" title="Key numbers">
    <Fact label="Accounts" :value="numbers.accounts ?? 'Off'" />
    <Fact label="Modules in the catalog" :value="`${numbers.listedModules} listed of ${numbers.modules}`" />
    <Fact label="Module installs" :value="numbers.installs" />
    <Fact label="Hosted game icons" :value="numbers.hostedIcons" />
    <Fact label="Catalog storage in use" :value="bytes(numbers.catalogBytes)" />
  </Group>
</template>
