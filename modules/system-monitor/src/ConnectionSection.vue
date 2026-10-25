<script setup lang="ts">
// The Connection section: is the PC online, how fast the router and the internet answer, how many pings get lost, how
// much goes through the network adapter, and the drops of the last 30 days. Tavora's connection watcher does the
// pinging (it runs even while this panel is hidden, so drops are logged); this only shows what it found. A red notice
// tops the section while the connection is down. No sound and no system notification, by design.
import { ArrowDown, ArrowUp } from "@lucide/vue";
import { cn, ConfirmDialog } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@tavora/official-ui/components/ui/collapsible";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import type { SystemConnection, SystemOutageKind } from "@tavora/sdk";
import { computed, ref } from "vue";
import { clock, dayAndClock, dropsToday, duration, lossPercent, lossTone, mbit, pingMs, pingTone, type DriveTone } from "./format";
import { language, plural, t } from "./i18n";
import type { Monitor } from "./monitor";

const props = defineProps<{ monitor: Monitor }>();

const lang = computed(() => language.value);
const connection = computed(() => props.monitor.connection.value);
const missing = computed(() => props.monitor.connectionMissing.value);
const outages = computed(() => props.monitor.outages.value);
/** The time the numbers are from; ongoing drops are measured up to it. */
const at = computed(() => props.monitor.snapshot.value?.at ?? Date.now());
const confirming = ref(false);

// The long texts say it all in the notice; the short ones fit the status card and the list. "Router OK" is only said when the router answered.
const KIND_TEXT: Record<SystemOutageKind, "state.offline" | "state.noRouter" | "state.noInternet"> = { offline: "state.offline", "no-router": "state.noRouter", "no-internet": "state.noInternet" };
const KIND_SHORT: Record<SystemOutageKind, "status.offline" | "status.noRouter" | "status.noInternet"> = { offline: "status.offline", "no-router": "status.noRouter", "no-internet": "status.noInternet" };

const isOff = computed(() => connection.value?.state === "off" || props.monitor.connectionSettings.value?.enabled === false);
const down = computed(() => {
  const state = connection.value?.state;
  return state && state !== "online" && state !== "off" ? (state as SystemOutageKind) : null;
});
const checking = computed(() => connection.value === null && !isOff.value);

const TEXT_TONE: Record<DriveTone, string> = { ok: "", warning: "text-warning", danger: "text-destructive" };

const status = computed(() => {
  if (isOff.value) return { text: t("state.off"), class: "text-muted-foreground" };
  if (checking.value) return { text: t("state.checking"), class: "text-muted-foreground" };
  if (down.value) return { text: t(KIND_SHORT[down.value]), class: "text-destructive" };
  return { text: t("state.online"), class: "text-success" };
});

const banner = computed(() => {
  const now = connection.value;
  if (!down.value || !now) return null;
  const since = now.since ?? at.value;
  const title = down.value === "no-internet" && now.routerMs === null ? t("state.noInternetShort") : t(KIND_TEXT[down.value]);
  return { title, text: t("banner.since", { time: clock(since, lang.value), duration: duration(at.value - since) }) };
});

/** A ping: the number, or a word when lost. A lost ping is yellow, and red while the connection is down. */
function ping(ms: number | null, found = true) {
  const now = connection.value as SystemConnection | null;
  if (!now) return { text: "", unit: false, class: "" };
  if (!found) return { text: t("ping.noRouter"), unit: false, class: "text-muted-foreground" };
  if (ms === null) return { text: t("ping.lost"), unit: false, class: down.value ? "text-destructive" : "text-warning" };
  return { text: pingMs(ms, lang.value), unit: true, class: TEXT_TONE[pingTone(ms)] };
}
const router = computed(() => ping(connection.value?.routerMs ?? null, connection.value?.routerFound ?? true));
const internet = computed(() => ping(connection.value?.internetMs ?? null));

const loss = computed(() => {
  const now = connection.value;
  return now ? { text: lossPercent(now.lossPercent, lang.value), class: TEXT_TONE[lossTone(now.lossPercent)] } : { text: "", class: "" };
});

const speed = computed(() => {
  const now = connection.value;
  return {
    down: now?.downMbit != null ? mbit(now.downMbit, lang.value) : "–",
    up: now?.upMbit != null ? mbit(now.upMbit, lang.value) : "–",
  };
});

const today = computed(() => dropsToday(outages.value, at.value));
const dropsText = computed(() => (today.value === 0 ? t("drops.none") : plural("drops.today", today.value)));

const rows = computed(() =>
  outages.value.map((outage) => {
    const sameDay = dropsToday([outage], at.value) === 1;
    return {
      key: outage.start,
      when: sameDay ? clock(outage.start, lang.value) : dayAndClock(outage.start, lang.value),
      length: outage.end === null ? t("drops.ongoing") : duration(outage.durationMs),
      kind: outage.kind === "no-internet" ? t("state.noInternetShort") : t(KIND_TEXT[outage.kind]),
      ongoing: outage.end === null,
    };
  }),
);

function clear(): void {
  confirming.value = false;
  void props.monitor.clearLog();
}

const CARD = "bg-card text-card-foreground flex flex-col gap-1.5 rounded-lg border p-2.5";
const LABEL = "text-muted-foreground flex-none text-[0.6875rem] font-medium tracking-wide uppercase";
const BIG = "text-[1.625rem] leading-none font-semibold tabular-nums";
</script>

<template>
  <div class="flex flex-col gap-2 p-2" data-testid="connection-section">
    <p v-if="missing" class="text-muted-foreground px-1 text-xs" data-testid="connection-old">{{ t("connection.old") }}</p>
    <template v-else>
      <Notice v-if="banner" variant="error" :title="banner.title" data-testid="connection-banner">{{ banner.text }}</Notice>

      <div class="grid grid-cols-1 items-start gap-2 @min-[620px]:grid-cols-3">
        <section :class="CARD" data-testid="connection-status">
          <header class="flex items-baseline gap-2">
            <span :class="LABEL">{{ t("status.title") }}</span>
          </header>
          <div :class="cn(BIG, 'text-center whitespace-nowrap', status.class)" data-testid="status-text">{{ status.text }}</div>
          <p class="text-muted-foreground truncate text-center text-xs tabular-nums" data-testid="status-detail">
            {{ isOff ? t("connection.off") : connection ? connection.target : "" }}
          </p>
        </section>

        <section :class="CARD" data-testid="connection-ping">
          <header class="flex items-baseline gap-2">
            <span :class="LABEL">{{ t("ping.title") }}</span>
          </header>
          <div class="grid grid-cols-2 gap-2 text-center">
            <div class="flex min-w-0 flex-col gap-1">
              <span :class="cn(BIG, 'truncate text-[1.375rem]', router.class)" data-testid="ping-router">{{ router.text }}<span v-if="router.unit" class="text-muted-foreground ml-0.5 text-sm font-normal">ms</span></span>
              <span class="text-muted-foreground text-xs">{{ t("ping.router") }}</span>
            </div>
            <div class="flex min-w-0 flex-col gap-1">
              <span :class="cn(BIG, 'truncate text-[1.375rem]', internet.class)" data-testid="ping-internet">{{ internet.text }}<span v-if="internet.unit" class="text-muted-foreground ml-0.5 text-sm font-normal">ms</span></span>
              <span class="text-muted-foreground text-xs">{{ t("ping.internet") }}</span>
            </div>
          </div>
        </section>

        <section :class="CARD" data-testid="connection-loss" :title="t('loss.hint')" tabindex="0">
          <header class="flex items-baseline gap-2">
            <span :class="LABEL">{{ t("loss.title") }}</span>
          </header>
          <div :class="cn(BIG, 'text-center', loss.class)" data-testid="loss-text">{{ loss.text }}<span v-if="loss.text" class="text-muted-foreground ml-0.5 text-base font-normal">%</span></div>
          <p class="text-muted-foreground truncate text-center text-xs">{{ t("loss.hint") }}</p>
        </section>

        <section :class="CARD" data-testid="connection-speed" :title="t('speed.hint')" tabindex="0">
          <header class="flex items-baseline gap-2">
            <span :class="LABEL">{{ t("speed.title") }}</span>
          </header>
          <div class="flex items-baseline justify-center gap-4 whitespace-nowrap">
            <span :class="cn(BIG, 'text-[1.375rem]')" data-testid="speed-down"><ArrowDown class="text-muted-foreground mr-0.5 inline size-4 align-[-0.1em]" :stroke-width="1.75" aria-hidden="true" />{{ speed.down }}</span>
            <span :class="cn(BIG, 'text-[1.375rem]')" data-testid="speed-up"><ArrowUp class="text-muted-foreground mr-0.5 inline size-4 align-[-0.1em]" :stroke-width="1.75" aria-hidden="true" />{{ speed.up }}</span>
          </div>
          <p class="text-muted-foreground text-center text-xs">{{ t("speed.unit") }}</p>
        </section>

        <section :class="cn(CARD, 'gap-1 @min-[620px]:col-span-2')" data-testid="connection-drops">
          <Collapsible>
            <div class="flex items-center gap-2">
              <CollapsibleTrigger class="min-w-0 flex-1 py-0.5" data-testid="drops-toggle">
                <span :class="LABEL">{{ t("drops.title") }}</span>
                <span class="min-w-0 flex-1 truncate text-right text-xs tabular-nums" data-testid="drops-today">{{ dropsText }}</span>
              </CollapsibleTrigger>
              <Button v-if="outages.length" variant="ghost" size="xs" data-testid="drops-clear" @click="confirming = true">{{ t("drops.clear") }}</Button>
            </div>
            <CollapsibleContent>
              <p v-if="rows.length === 0" class="text-muted-foreground pt-1.5 text-xs" data-testid="drops-empty">{{ t("drops.empty") }}</p>
              <ul v-else class="mt-1.5 flex max-h-40 flex-col gap-0.5 overflow-y-auto text-xs" data-testid="drops-list">
                <li v-for="row in rows" :key="row.key" class="flex items-baseline gap-2 tabular-nums" data-testid="drop-row">
                  <span class="flex-none font-medium">{{ row.when }}</span>
                  <span :class="cn('flex-none', row.ongoing && 'text-destructive')">{{ row.length }}</span>
                  <span class="text-muted-foreground min-w-0 flex-1 truncate text-right">{{ row.kind }}</span>
                </li>
              </ul>
            </CollapsibleContent>
          </Collapsible>
        </section>
      </div>
    </template>

    <ConfirmDialog v-if="confirming" :title="t('drops.clearTitle')" :description="t('drops.clearText')" :confirm="t('drops.clearConfirm')" @confirm="clear" @cancel="confirming = false" />
  </div>
</template>
