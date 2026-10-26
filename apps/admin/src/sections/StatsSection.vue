<script setup lang="ts">
// Plain daily totals, laid out to screenshot for sponsors. Nothing here is about a person.
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Sparkline } from "@tavora/official-ui/components/ui/sparkline";
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { call, message, WrongToken } from "../api";
import Fact from "../components/Fact.vue";
import Group from "../components/Group.vue";
import PageTitle from "../components/PageTitle.vue";
import { refreshTick } from "../nav";
import type { StatKind, Stats } from "../types";

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "A year" },
];
const SHOWN = 10;

const days = ref("30");
const stats = shallowRef<Stats | null>(null);
const error = ref("");

async function reload(): Promise<void> {
  try {
    const response = await call(`/api/stats?days=${days.value}`);
    if (response.status === 503) throw new Error("Counting is off on this server.");
    if (!response.ok) throw new Error("Can't load the stats.");
    stats.value = (await response.json()) as Stats;
    error.value = "";
  } catch (failure) {
    if (!(failure instanceof WrongToken)) error.value = message(failure);
  }
}

/** Every version or module of a kind added up, per day. */
function perDay(kind: StatKind): number[] {
  const rows = Object.values(stats.value?.counts[kind] ?? {});
  return (stats.value?.days ?? []).map((_, index) => rows.reduce((sum, row) => sum + (row[index] ?? 0), 0));
}
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const KINDS: { kind: StatKind; label: string; color: string }[] = [
  { kind: "app-installer", label: "Installer downloads", color: "primary" },
  { kind: "app-update", label: "App updates", color: "success" },
  { kind: "module-install", label: "Module installs", color: "warning" },
  { kind: "module-update", label: "Module updates", color: "primary" },
];
const lines = computed(() => KINDS.map((entry) => ({ ...entry, values: perDay(entry.kind), total: sum(perDay(entry.kind)) })));

/** The most counted versions or modules of a kind over the range. */
function top(kind: StatKind): [string, number][] {
  return Object.entries(stats.value?.totals[kind] ?? {})
    .filter(([, count]) => count > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, SHOWN);
}
const installs = computed(() => top("module-install"));
const versions = computed(() => top("app-installer"));

const latest = computed(() => [...(stats.value?.accounts ?? [])].reverse().find((entry) => entry !== null) ?? null);
const accountTotals = computed(() => (stats.value?.accounts ?? []).map((entry) => entry?.total ?? null));
const accountLine = computed(() => {
  // Days without a snapshot repeat the day before, so the line doesn't drop to zero.
  let last = 0;
  return accountTotals.value.map((value) => (last = value ?? last));
});
const range = computed(() => (stats.value ? `${stats.value.from} to ${stats.value.to}` : ""));

onMounted(() => void reload());
watch([days, refreshTick], () => void reload());
</script>

<template>
  <PageTitle title="Stats" :hint="range ? `Daily totals, ${range} (UTC).` : 'Daily totals.'">
    <SegmentedControl v-model="days" :options="RANGES" label="Range" />
  </PageTitle>
  <Notice v-if="error" variant="error">{{ error }}</Notice>

  <template v-if="stats">
    <Group title="At a glance">
      <Fact v-for="line in lines" :key="line.kind" :label="line.label" :value="line.total" />
      <Fact v-if="latest" label="Accounts" :value="latest.total" />
      <Fact v-if="latest" label="Active in the last 30 days" :value="latest.active30" />
    </Group>

    <Group title="Per day">
      <div v-for="line in lines" :key="line.kind" class="flex flex-col gap-1 px-3 py-3">
        <div class="flex items-baseline justify-between text-sm">
          <p>{{ line.label }}</p>
          <span class="text-muted-foreground text-xs tabular-nums">most in a day: {{ Math.max(0, ...line.values) }}</span>
        </div>
        <Sparkline :values="line.values" :min="0" :max="Math.max(1, ...line.values)" :height="56" :color="line.color" :label="`${line.label} per day`" />
      </div>
      <div v-if="latest" class="flex flex-col gap-1 px-3 py-3">
        <div class="flex items-baseline justify-between text-sm">
          <p>Accounts</p>
          <span class="text-muted-foreground text-xs tabular-nums">now: {{ latest.total }}</span>
        </div>
        <Sparkline :values="accountLine" :min="0" :max="Math.max(1, ...accountLine)" :height="56" color="success" label="Accounts per day" />
      </div>
    </Group>

    <Group title="Most installed modules" :hint="`Top ${SHOWN} in this range.`">
      <Fact v-for="[id, count] in installs" :key="id" :label="id" :value="count" />
      <p v-if="installs.length === 0" class="text-muted-foreground px-3 py-3 text-sm">No installs in this range.</p>
    </Group>

    <Group title="Installer downloads per version">
      <Fact v-for="[version, count] in versions" :key="version" :label="version" :value="count" />
      <p v-if="versions.length === 0" class="text-muted-foreground px-3 py-3 text-sm">No downloads in this range.</p>
    </Group>
  </template>
  <p v-else-if="!error" class="text-muted-foreground text-sm">Loading…</p>
</template>
