<script setup lang="ts">
// The System section: one compact row for each block the panel shows (CPU, graphics card, memory, drives).
// A Connection section can sit next to it later; it gets its own component like this one.
import { Progress } from "@tavora/official-ui/components/ui/progress";
import { cn } from "@tavora/official-ui";
import { computed } from "vue";
import { driveTone, percent, size, speed, usedPercent, type DriveTone } from "./format";
import { language, t } from "./i18n";
import MetricRow from "./MetricRow.vue";
import type { Monitor } from "./monitor";
import { PEAK_FROM_MS, pickGpu, watchedDrives } from "./settings";

const props = defineProps<{ monitor: Monitor }>();

const info = computed(() => props.monitor.info.value);
const snapshot = computed(() => props.monitor.snapshot.value);
const blocks = computed(() => props.monitor.panel.value.blocks);
const lang = computed(() => language.value);
const showPeak = computed(() => props.monitor.app.value.intervalMs >= PEAK_FROM_MS);

const pct = (value: number) => t("usage", { percent: percent(value, lang.value) });
const peakText = (value: number | undefined) => (value !== undefined && showPeak.value ? t("peak", { percent: percent(value, lang.value) }) : "");

// CPU
const cpu = computed(() => {
  const now = snapshot.value?.cpu;
  return {
    usage: now ? pct(now.usage) : "",
    peak: peakText(now?.peak),
    // Per-core use for the hover, one line each.
    hint: now ? now.cores.map((core, index) => `${t("cores", { number: index + 1 })}: ${pct(core)}`).join("\n") : "",
  };
});

// Graphics card
const gpuInfo = computed(() => {
  const id = info.value ? pickGpu(info.value, props.monitor.panel.value.gpu) : null;
  return info.value?.gpus.find((gpu) => gpu.id === id) ?? null;
});
const gpu = computed(() => {
  const now = snapshot.value?.gpus?.find((entry) => entry.id === gpuInfo.value?.id);
  const total = gpuInfo.value?.vramBytes ?? null;
  const used = now?.vramUsedBytes ?? null;
  return {
    usage: now ? pct(now.usage) : "",
    peak: peakText(now?.peak),
    detail: used !== null && total ? t("vram", { used: size(used, lang.value), total: size(total, lang.value) }) : "",
  };
});

// Memory
const ram = computed(() => {
  const now = snapshot.value?.ram;
  const total = now?.totalBytes ?? info.value?.ramBytes ?? 0;
  const used = now?.usedBytes ?? 0;
  return {
    value: total > 0 ? Math.min(100, (used / total) * 100) : 0,
    text: now ? t("ram.used", { used: size(used, lang.value), total: size(total, lang.value) }) : "",
  };
});

// Drives
const drives = computed(() => {
  const current = info.value;
  if (!current) return [];
  return watchedDrives(current, props.monitor.app.value).map((id) => {
    const known = current.drives.find((drive) => drive.id === id);
    const live = snapshot.value?.drives?.find((drive) => drive.id === id);
    const total = live?.totalBytes ?? known?.totalBytes ?? null;
    const free = live?.freeBytes ?? null;
    const missing = live ? !live.connected : known === undefined;
    return {
      id,
      label: known?.label ?? "",
      missing,
      loaded: live !== undefined,
      total,
      free,
      tone: driveTone(free, total),
      used: usedPercent(free, total),
      text:
        free === null
          ? ""
          : total
            ? t("drive.free", { free: size(free, lang.value), total: size(total, lang.value) })
            : t("drive.freeOnly", { free: size(free, lang.value) }),
      io: live && live.connected ? `${t("drive.read", { speed: speed(live.readBytesPerSec, lang.value) })} · ${t("drive.write", { speed: speed(live.writeBytesPerSec, lang.value) })}` : "",
    };
  });
});

const BAR_TONE: Record<DriveTone, string> = {
  ok: "",
  warning: "[&>[data-slot=progress-indicator]]:bg-warning",
  danger: "[&>[data-slot=progress-indicator]]:bg-destructive",
};
const TEXT_TONE: Record<DriveTone, string> = { ok: "", warning: "text-warning", danger: "text-destructive" };
// No animation on values: a bar jumps to its new place.
const BAR = "[&>[data-slot=progress-indicator]]:transition-none";

</script>

<template>
  <div class="flex flex-col divide-y" data-testid="system-section">
    <MetricRow
      v-if="blocks.cpu"
      testid="block-cpu"
      :title="t('cpu.title')"
      :name="info?.cpu.model ?? ''"
      :usage="cpu.usage"
      :peak="cpu.peak"
      detail=""
      :hint="cpu.hint"
      :history="monitor.cpuHistory"
    />

    <MetricRow
      v-if="blocks.gpu && gpuInfo"
      testid="block-gpu"
      :title="t('gpu.title')"
      :name="gpuInfo.name"
      :usage="gpu.usage"
      :peak="gpu.peak"
      :detail="gpu.detail"
      hint=""
      :history="monitor.gpuHistory"
    />

    <section v-if="blocks.ram" class="flex flex-col gap-1 px-3 py-1.5" data-testid="block-ram">
      <div class="flex items-baseline gap-2">
        <span class="text-muted-foreground w-14 flex-none text-xs font-medium">{{ t("ram.title") }}</span>
        <span class="min-w-0 flex-1 truncate tabular-nums" data-testid="ram-text">{{ ram.text }}</span>
      </div>
      <Progress :model-value="ram.value" :class="cn('ml-16 w-auto', BAR)" :aria-label="t('ram.title')" />
    </section>

    <section v-if="blocks.drives" class="flex flex-col gap-1.5 px-3 py-1.5" data-testid="block-drives">
      <p v-if="drives.length === 0" class="text-muted-foreground text-xs">{{ t("drive.none") }}</p>
      <div v-for="drive in drives" :key="drive.id" class="flex flex-col gap-1" :data-testid="`drive-${drive.id}`">
        <div class="flex items-baseline gap-2">
          <span class="text-muted-foreground w-14 flex-none text-xs font-medium">{{ drive.id }}</span>
          <span class="min-w-0 flex-1 truncate">{{ drive.label }}</span>
          <span v-if="drive.missing" class="text-muted-foreground flex-none text-xs" data-testid="drive-missing">{{ t("drive.missing") }}</span>
          <span v-else :class="cn('flex-none text-xs tabular-nums', TEXT_TONE[drive.tone])" data-testid="drive-free">{{ drive.text }}</span>
        </div>
        <template v-if="!drive.missing && drive.loaded">
          <Progress :model-value="drive.used" :class="cn('ml-16 w-auto', BAR, BAR_TONE[drive.tone])" :aria-label="`${drive.id} ${drive.text}`" />
          <p class="text-muted-foreground pl-16 text-xs tabular-nums" data-testid="drive-io">{{ drive.io }}</p>
        </template>
      </div>
    </section>
  </div>
</template>
