<script setup lang="ts">
// The traffic card of the Connection section: what this PC downloaded and uploaded this week, this month and in the 3
// months before, as Windows counts it (Tavora reads Windows' record, so it counts while Tavora is closed too). Big is
// both together, as a data plan counts it; below are the two parts. A month Windows' record only partly covers says
// from when it counts. Shown only when the player ticked Traffic in the menu.
import { ArrowDown, ArrowUp } from "@lucide/vue";
import { cn } from "@tavora/official-ui";
import type { SystemTrafficPeriod } from "@tavora/sdk";
import { computed } from "vue";
import { monthName, shortDay, size } from "./format";
import { language, t } from "./i18n";
import type { Monitor } from "./monitor";

const props = defineProps<{ monitor: Monitor }>();

const lang = computed(() => language.value);
const status = computed(() => props.monitor.trafficStatus.value);

const cells = computed(() => {
  const traffic = props.monitor.traffic.value;
  if (!traffic) return [];
  const cell = (key: string, label: string, period: SystemTrafficPeriod) => {
    const known = period.downBytes !== null && period.upBytes !== null;
    return {
      key,
      label,
      total: known ? size(period.downBytes! + period.upBytes!, lang.value) : "–",
      down: known ? size(period.downBytes!, lang.value) : "",
      up: known ? size(period.upBytes!, lang.value) : "",
      note: !known ? t("traffic.none") : period.countedFrom !== null && period.countedFrom > period.start ? t("traffic.from", { date: shortDay(period.countedFrom, lang.value) }) : "",
    };
  };
  return [cell("week", t("traffic.week"), traffic.week), ...traffic.months.map((month) => cell(String(month.start), monthName(month.start, lang.value), month))];
});

const message = computed(() => (status.value === "old" ? t("traffic.old") : status.value === "error" ? t("traffic.error") : status.value === "loading" && cells.value.length === 0 ? t("traffic.loading") : ""));

const CARD = "bg-card text-card-foreground flex flex-col gap-1.5 rounded-lg border p-2.5";
const LABEL = "text-muted-foreground flex-none text-[0.6875rem] font-medium tracking-wide uppercase";
const BIG = "text-[1.375rem] leading-none font-semibold tabular-nums";
</script>

<template>
  <section :class="cn(CARD, 'col-span-full')" data-testid="connection-traffic" :title="t('traffic.hint')">
    <header class="flex items-baseline gap-2">
      <span :class="LABEL">{{ t("traffic.title") }}</span>
    </header>
    <p v-if="message" class="text-muted-foreground text-xs" data-testid="traffic-message">{{ message }}</p>
    <!-- Five in a row on a wide panel, three below 620 px, two on a narrow one. -->
    <div v-else class="grid grid-cols-2 gap-x-2 gap-y-3 text-center @min-[320px]:grid-cols-3 @min-[620px]:grid-cols-5">
      <div v-for="cell in cells" :key="cell.key" class="flex min-w-0 flex-col gap-1" data-testid="traffic-cell">
        <span class="text-muted-foreground truncate text-xs">{{ cell.label }}</span>
        <span :class="cn(BIG, 'whitespace-nowrap')" data-testid="traffic-total">{{ cell.total }}</span>
        <span v-if="cell.down" class="text-muted-foreground truncate text-xs whitespace-nowrap tabular-nums">
          <ArrowDown class="inline size-3 align-[-0.1em]" :stroke-width="1.75" aria-hidden="true" />{{ cell.down }}
          <ArrowUp class="ml-1 inline size-3 align-[-0.1em]" :stroke-width="1.75" aria-hidden="true" />{{ cell.up }}
        </span>
        <span v-if="cell.note" class="text-muted-foreground truncate text-xs" data-testid="traffic-note">{{ cell.note }}</span>
      </div>
    </div>
  </section>
</template>
