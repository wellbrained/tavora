<script setup lang="ts">
// The System section: a card for each block the panel shows (CPU, graphics card, memory, one for each drive), in
// a grid that follows the panel's width (container queries in CSS, no script): 1 column under 420 px, 2 up to 720 px,
// 3 above. A Connection section can sit next to it later; it gets its own component like this one.
import { cn } from "@tavora/official-ui";
import { Progress } from "@tavora/official-ui/components/ui/progress";
import { computed } from "vue";
import { driveTone, percent, size, speed, usedPercent, type DriveTone } from "./format";
import { language, t } from "./i18n";
import MetricCard from "./MetricCard.vue";
import type { Monitor } from "./monitor";
import { PEAK_FROM_MS, pickGpu, watchedDrives } from "./settings";

const props = defineProps<{ monitor: Monitor }>();

const info = computed(() => props.monitor.info.value);
const snapshot = computed(() => props.monitor.snapshot.value);
const blocks = computed(() => props.monitor.panel.value.blocks);
const lang = computed(() => language.value);
const showPeak = computed(() => props.monitor.app.value.intervalMs >= PEAK_FROM_MS);

const pct = (value: number) => `${percent(value, lang.value)} %`;
const peakText = (value: number | undefined) => (value !== undefined && showPeak.value ? t("peak", { percent: percent(value, lang.value) }) : "");

// The graphs: a fresh array with each snapshot, which is what redraws them.
const cpuValues = computed(() => (snapshot.value, props.monitor.cpuHistory.values()));
const gpuValues = computed(() => (snapshot.value, props.monitor.gpuHistory.values()));

// CPU
const cpu = computed(() => {
  const now = snapshot.value?.cpu;
  return {
    usage: now ? percent(now.usage, lang.value) : "",
    peak: peakText(now?.peak),
    detail: info.value ? t("threads", { count: info.value.cpu.threads }) : "",
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
    usage: now ? percent(now.usage, lang.value) : "",
    peak: peakText(now?.peak),
    detail: used !== null && total ? t("vram", { used: size(used, lang.value).replace(/ GB$/, ""), total: size(total, lang.value) }) : "",
  };
});

// Memory
const ram = computed(() => {
  const now = snapshot.value?.ram;
  const total = now?.totalBytes ?? info.value?.ramBytes ?? 0;
  const used = now?.usedBytes ?? 0;
  const value = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return {
    value,
    big: now ? percent(value, lang.value) : "",
    line: now ? t("ram.line", { used: size(used, lang.value), free: size(Math.max(0, total - used), lang.value) }) : "",
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
// No animation on values: a bar jumps to its new place. Neutral unless a drive is low.
const BAR = "[&>[data-slot=progress-indicator]]:transition-none [&>[data-slot=progress-indicator]]:bg-muted-foreground";
const CARD = "bg-card text-card-foreground flex flex-col gap-1.5 rounded-lg border p-2.5";
const LABEL = "text-muted-foreground flex-none text-[0.6875rem] font-medium tracking-wide uppercase";
</script>

<template>
  <div class="grid grid-cols-1 items-start gap-2 p-2 @min-[620px]:grid-cols-3" data-testid="system-section">
    <MetricCard
      v-if="blocks.cpu"
      testid="block-cpu"
      :title="t('cpu.title')"
      :name="info?.cpu.model ?? ''"
      :usage="cpu.usage"
      :temperature-hint="t('temp.hint')"
      :peak="cpu.peak"
      :detail="cpu.detail"
      :hint="cpu.hint"
      :values="cpuValues"
      :graph-label="t('cpu.title')"
    />

    <MetricCard
      v-if="blocks.gpu && gpuInfo"
      testid="block-gpu"
      :title="t('gpu.title')"
      :name="gpuInfo.name"
      :usage="gpu.usage"
      :temperature-hint="t('temp.hint')"
      :peak="gpu.peak"
      :detail="gpu.detail"
      hint=""
      :values="gpuValues"
      :graph-label="t('gpu.title')"
    />

    <section v-if="blocks.ram" :class="CARD" data-testid="block-ram">
      <header class="flex items-baseline justify-between gap-2">
        <span :class="LABEL">{{ t("ram.title") }}</span>
        <span class="text-2xl leading-none font-semibold tabular-nums" data-testid="ram-big">{{ ram.big }}<span v-if="ram.big" class="text-muted-foreground ml-0.5 text-sm font-normal">%</span></span>
      </header>
      <Progress :model-value="ram.value" :class="cn(BAR)" :aria-label="t('ram.title')" />
      <p class="text-muted-foreground text-xs tabular-nums" data-testid="ram-text">{{ ram.line }}</p>
    </section>

    <p v-if="blocks.drives && drives.length === 0" class="text-muted-foreground col-span-full text-xs" data-testid="no-drives">{{ t("drive.none") }}</p>
    <!-- Drives flow in their own grid under the cards: one per row in one column, else as many as stay readable (about 250 px each). -->
    <div v-if="blocks.drives && drives.length" class="col-span-full grid grid-cols-1 items-start gap-2 @min-[620px]:grid-cols-[repeat(auto-fill,minmax(250px,1fr))]">
      <section v-for="drive in drives" :key="drive.id" class="bg-card text-card-foreground flex flex-col gap-1 rounded-lg border px-2.5 py-2" :data-testid="`drive-${drive.id}`">
        <div class="flex items-baseline gap-2">
          <span class="text-muted-foreground flex-none text-xs font-medium">{{ drive.id }}</span>
          <span class="min-w-0 flex-1 truncate">{{ drive.label }}</span>
          <span v-if="drive.missing" class="text-muted-foreground flex-none text-xs" data-testid="drive-missing">{{ t("drive.missing") }}</span>
          <span v-else :class="cn('flex-none text-xs tabular-nums', TEXT_TONE[drive.tone])" data-testid="drive-free">{{ drive.text }}</span>
        </div>
        <template v-if="!drive.missing && drive.loaded">
          <Progress :model-value="drive.used" :class="cn(BAR, BAR_TONE[drive.tone])" :aria-label="`${drive.id} ${drive.text}`" />
          <p class="text-muted-foreground text-xs tabular-nums" data-testid="drive-io">{{ drive.io }}</p>
        </template>
      </section>
    </div>
  </div>
</template>
