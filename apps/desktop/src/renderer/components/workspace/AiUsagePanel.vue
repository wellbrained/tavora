<script setup lang="ts">
// The AI usage panel: for each Claude and Codex account, how much of each
// allowance window is left and when it resets, one compact line per window.
// The main process takes the readings (main/ai-usage.ts); this only shows them.
// A reading that is old or failed stays visible but is marked "Last known".
import { Info, RefreshCw, Settings } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AiUsageAccount, AiUsageWindow } from "../../../shared/host-api";
import { act, aiUsage, openSettings } from "../../host";
import { formatDate, t } from "../../i18n";
import { barTone, durationWording, leftPercent, STATE_TEXT, windowLabel } from "./ai-usage-ui";

const view = computed(() => aiUsage.value);
const accounts = computed(() => view.value?.accounts ?? []);

// Countdowns move on their own; the readings come from the main process.
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;
onMounted(() => (ticker = setInterval(() => (now.value = Date.now()), 30_000)));
onBeforeUnmount(() => clearInterval(ticker));

const wording = (ms: number) => {
  const { key, params } = durationWording(ms);
  return t(key, params);
};

function resetText(resetsAt: number | null): string {
  if (resetsAt === null) return t("aiUsage.panel.noReset");
  // A reset time in the past does not mean a fresh allowance until the next reading says so.
  return resetsAt <= now.value ? t("aiUsage.panel.resetDue") : t("aiUsage.panel.resetsIn", { time: wording(resetsAt - now.value) });
}

function updatedText(account: AiUsageAccount): string {
  if (account.fetchedAt === null) return t(account.state === "waiting" ? "aiUsage.panel.reading" : "aiUsage.panel.neverRead");
  const ago = now.value - account.fetchedAt;
  return ago < 60_000 ? t("aiUsage.panel.updatedNow") : t("aiUsage.panel.updated", { time: wording(ago) });
}

const style = computed(() => view.value?.style ?? "remaining");
/** The number the bar and text show: what is left, or what is used, as the player chose. */
const shown = (window: AiUsageWindow) => (style.value === "used" ? 100 - leftPercent(window) : leftPercent(window));

/** The name's hover text: where the login lives, and who is signed in when the provider said. */
function identity(account: AiUsageAccount): string {
  return [account.email ? t("aiUsage.panel.signedInAs", { email: account.email }) : null, account.directory].filter(Boolean).join("\n");
}

function resetsHint(account: AiUsageAccount): string {
  const expiry = account.resets?.earliestExpiry;
  return expiry ? t("aiUsage.panel.resetsHintDate", { date: formatDate(new Date(expiry), { dateStyle: "medium", timeStyle: "short" }) }) : t("aiUsage.panel.resetsHint");
}

const TONE = { ok: "bg-success", low: "bg-warning", empty: "bg-destructive" } as const;
</script>

<template>
  <div class="bg-background flex size-full flex-col overflow-hidden text-sm" data-testid="ai-usage-panel">
    <div v-if="view && accounts.length === 0" class="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
      <p class="font-medium">{{ t("aiUsage.panel.emptyTitle") }}</p>
      <p class="text-muted-foreground max-w-xs">{{ t("aiUsage.panel.emptyText") }}</p>
      <Button class="mt-2" size="sm" data-testid="ai-usage-open-settings" @click="openSettings({ section: 'integrations', setting: 'ai-usage-accounts' })">
        <Settings :stroke-width="1.75" />{{ t("aiUsage.panel.openSettings") }}
      </Button>
    </div>

    <template v-else>
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-2">
        <section v-for="account in accounts" :key="account.id" class="flex flex-col gap-1" :data-testid="`ai-usage-account-${account.id}`">
          <header class="flex items-center gap-2">
            <span class="bg-secondary text-secondary-foreground flex-none rounded-sm px-1.5 py-px text-xs font-medium">{{ t(`aiUsage.provider.${account.provider}`) }}</span>
            <span class="min-w-0 truncate font-medium" :title="identity(account)" data-testid="ai-usage-name">{{ account.label }}</span>
            <span v-if="account.plan" class="text-muted-foreground flex-none text-xs" data-testid="ai-usage-plan">{{ account.plan }}</span>
            <span
              v-if="account.resets"
              class="bg-secondary text-secondary-foreground flex-none rounded-sm px-1.5 py-px text-xs"
              :title="resetsHint(account)"
              data-testid="ai-usage-resets"
            >
              {{ t("aiUsage.panel.resets", { count: account.resets.available }) }}
            </span>
            <span class="flex-1" />
            <span
              v-if="account.stale"
              class="text-warning flex flex-none items-center gap-1 text-xs"
              :title="t('aiUsage.panel.staleHint')"
              data-testid="ai-usage-stale"
            >
              <Info class="size-3.5" :stroke-width="1.75" />{{ t("aiUsage.panel.stale") }}
            </span>
            <span class="text-muted-foreground flex-none text-xs">{{ updatedText(account) }}</span>
          </header>

          <ul v-if="account.windows.length" :class="cn('flex flex-col gap-1', account.stale && 'opacity-70')">
            <li
              v-for="(window, position) in account.windows"
              :key="position"
              class="grid grid-cols-[4.5rem_minmax(2rem,1fr)_5.5rem_7.5rem] items-center gap-x-2"
              :title="window.resetsAt ? t('aiUsage.panel.resetHint', { date: formatDate(new Date(window.resetsAt), { dateStyle: 'medium', timeStyle: 'short' }) }) : undefined"
              data-testid="ai-usage-window"
            >
              <span class="min-w-0 truncate">{{ windowLabel(window, t) }}</span>
              <div
                class="bg-muted h-1.5 overflow-hidden rounded-full"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="shown(window)"
                :aria-label="windowLabel(window, t)"
              >
                <!-- The bar follows the chosen style; its colour always follows what is left. -->
                <div :class="cn('h-full rounded-full', TONE[barTone(leftPercent(window))])" :style="{ width: `${shown(window)}%` }" />
              </div>
              <span class="whitespace-nowrap tabular-nums">{{ t(style === "used" ? "aiUsage.panel.used" : "aiUsage.panel.left", { percent: shown(window) }) }}</span>
              <span class="text-muted-foreground truncate whitespace-nowrap tabular-nums">{{ resetText(window.resetsAt) }}</span>
            </li>
          </ul>
          <p v-if="account.state !== 'ready'" class="text-muted-foreground text-xs" data-testid="ai-usage-state">{{ t(STATE_TEXT[account.state]) }}</p>
        </section>
      </div>

      <footer class="flex flex-none items-center justify-end border-t px-2 py-1">
        <Button
          variant="ghost"
          size="icon-xs"
          :disabled="view?.refreshing"
          :title="t('aiUsage.panel.refresh')"
          :aria-label="t('aiUsage.panel.refresh')"
          data-testid="ai-usage-refresh"
          @click="act({ type: 'ai-usage-refresh' })"
        >
          <RefreshCw :class="cn(view?.refreshing && 'animate-spin')" :stroke-width="1.75" />
        </Button>
      </footer>
    </template>
  </div>
</template>
