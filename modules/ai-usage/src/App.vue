<script setup lang="ts">
// AI Usage: for each Claude and Codex account, how much of each allowance window is left and when
// it resets, one compact line per window. Tavora's ai-usage connector reads the accounts with their
// logins; this module only ever sees the providers' answers. A reading that is old or failed stays
// visible but is marked Last known. The cog opens the module's own settings, kept for every game.
import { ArrowDown, ArrowUp, Info, RefreshCw, Settings as SettingsIcon } from "@lucide/vue";
import { cn, connectModule, errorMessage, SegmentedControl } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { locale, plural, setLanguage, t } from "./i18n";
import { createMonitor, TICK_MS, type AccountStatus, type AccountView, type Monitor } from "./monitor";
import { barTone, durationWording, INTERVALS, leftPercent, STALE_INTERVALS, windowLabel, type UsageStyle, type UsageWindow } from "./usage";

const monitor = shallowRef<Monitor | null>(null);
const error = ref<string | null>(null);
const showSettings = ref(false);

const accounts = computed(() => monitor.value?.accounts.value ?? []);
const settings = computed(() => monitor.value?.settings.value ?? { refreshMinutes: 5, style: "remaining" as const });

// Countdowns move on their own; readings come from the connector.
const now = ref(Date.now());
const cleanup: (() => void)[] = [];

onMounted(async () => {
  try {
    const sdk = await connectModule(setLanguage);
    const started = createMonitor(sdk);
    cleanup.push(
      sdk.connectors.aiUsage.onAccountsChange(() => void started.accountsChanged()),
      sdk.lifecycle.onSuspend(() => started.suspend()),
      sdk.lifecycle.onResume(() => {
        now.value = Date.now();
        started.resume();
      }),
    );
    await started.start();
    const ticker = setInterval(() => (now.value = Date.now()), TICK_MS);
    cleanup.push(() => clearInterval(ticker), () => started.stop());
    monitor.value = started;
  } catch (reason) {
    error.value = errorMessage(reason);
  }
});

onBeforeUnmount(() => cleanup.forEach((fn) => fn()));

const wording = (ms: number) => {
  const { key, params } = durationWording(ms);
  return t(key, params);
};
const dateTime = (time: number) => new Date(time).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });

function resetText(resetsAt: number | null): string {
  if (resetsAt === null) return t("panel.noReset");
  // A reset time in the past does not mean a fresh allowance until the next reading says so.
  return resetsAt <= now.value ? t("panel.resetDue") : t("panel.resetsIn", { time: wording(resetsAt - now.value) });
}

function updatedText(account: AccountView): string {
  if (account.reading === null) return t(account.status === "waiting" ? "panel.reading" : "panel.neverRead");
  const ago = now.value - account.reading.fetchedAt;
  return ago < 60_000 ? t("panel.updatedNow") : t("panel.updated", { time: wording(ago) });
}

/** Last known usage, not a current promise: older than expected, or the newest try failed. */
function stale(account: AccountView): boolean {
  if (account.reading === null) return false;
  if (account.status !== "ok" && account.status !== "waiting") return true;
  return now.value - account.reading.fetchedAt > settings.value.refreshMinutes * 60_000 * STALE_INTERVALS;
}

/** The number the bar and text show: what is left, or what is used, as the player chose. */
const shown = (window: UsageWindow) => (settings.value.style === "used" ? 100 - leftPercent(window) : leftPercent(window));

/** The name's hover text: who is signed in, when the provider said. */
const identity = (account: AccountView) => (account.email ? t("panel.signedInAs", { email: account.email }) : undefined);

function resetsHint(account: AccountView): string {
  const expiry = account.resets?.earliestExpiry;
  return expiry ? t("panel.resetsHintDate", { date: dateTime(expiry) }) : t("panel.resetsHint");
}

const STATE_TEXT = {
  waiting: "state.waiting",
  "sign-in": "state.signIn",
  "rate-limited": "state.rateLimited",
  "api-key": "state.apiKey",
  unavailable: "state.unavailable",
  "cli-missing": "state.cliMissing",
} as const satisfies Record<Exclude<AccountStatus, "ok">, string>;

const TONE = { ok: "bg-success", low: "bg-warning", empty: "bg-destructive" } as const;

const style = computed<UsageStyle>({
  get: () => settings.value.style,
  set: (value) => void monitor.value?.setSettings({ style: value }),
});
const interval = computed({
  get: () => String(settings.value.refreshMinutes),
  set: (value: string) => void monitor.value?.setSettings({ refreshMinutes: Number(value) }),
});
const intervalOptions = computed(() => INTERVALS.map((minutes) => ({ value: String(minutes), label: t("settings.every", { minutes }), testid: `interval-${minutes}` })));
</script>

<template>
  <p v-if="!monitor" class="text-muted-foreground p-4 text-sm" data-testid="status">
    {{ error ? t("connectError", { error }) : t("loading") }}
  </p>
  <div v-else class="bg-background flex size-full flex-col overflow-hidden text-sm" data-testid="ai-usage-panel">
    <p v-if="monitor.denied.value" class="text-muted-foreground flex flex-1 items-center justify-center p-4 text-center" data-testid="ai-usage-denied">
      {{ t("denied") }}
    </p>

    <!-- The module's own settings, shared by every game. -->
    <div v-else-if="showSettings" class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3" data-testid="ai-usage-settings">
      <h2 class="font-medium">{{ t("settings.title") }}</h2>
      <div class="flex flex-col gap-1.5">
        <span class="text-muted-foreground text-xs font-medium">{{ t("settings.style") }}</span>
        <SegmentedControl
          v-model="style"
          :label="t('settings.style')"
          :options="[
            { value: 'remaining', label: t('settings.styleRemaining'), testid: 'style-remaining' },
            { value: 'used', label: t('settings.styleUsed'), testid: 'style-used' },
          ]"
        />
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="text-muted-foreground text-xs font-medium">{{ t("settings.interval") }}</span>
        <SegmentedControl v-model="interval" class="self-start" :label="t('settings.interval')" :options="intervalOptions" />
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="text-muted-foreground text-xs font-medium">{{ t("settings.order") }}</span>
        <p v-if="!accounts.length" class="text-muted-foreground">{{ t("settings.orderNone") }}</p>
        <ol v-else class="flex flex-col rounded-lg border" data-testid="ai-usage-order">
          <li v-for="(account, position) in accounts" :key="account.info.id" class="flex items-center gap-2 border-b py-1 pr-1 pl-3 last:border-b-0" :data-testid="`order-${account.info.id}`">
            <span class="min-w-0 flex-1 truncate">{{ account.info.label }} <span class="text-muted-foreground">· {{ t(`provider.${account.info.provider}`) }}</span></span>
            <Button
              variant="ghost"
              size="icon-xs"
              :disabled="position === 0"
              :title="t('settings.moveUp', { name: account.info.label })"
              :aria-label="t('settings.moveUp', { name: account.info.label })"
              data-testid="move-up"
              @click="monitor.move(account.info.id, -1)"
            >
              <ArrowUp :stroke-width="1.75" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              :disabled="position === accounts.length - 1"
              :title="t('settings.moveDown', { name: account.info.label })"
              :aria-label="t('settings.moveDown', { name: account.info.label })"
              data-testid="move-down"
              @click="monitor.move(account.info.id, 1)"
            >
              <ArrowDown :stroke-width="1.75" />
            </Button>
          </li>
        </ol>
        <p class="text-muted-foreground text-xs">{{ t("settings.accountsNote") }}</p>
      </div>
    </div>

    <EmptyState v-else-if="accounts.length === 0" class="m-3 flex-1 justify-center" :title="t('empty.title')" :description="t('empty.text')" data-testid="ai-usage-empty" />

    <div v-else class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-2">
      <section v-for="account in accounts" :key="account.info.id" class="flex flex-col gap-1" :data-testid="`ai-usage-account-${account.info.id}`">
        <header class="flex items-center gap-2">
          <span class="bg-secondary text-secondary-foreground flex-none rounded-sm px-1.5 py-px text-xs font-medium">{{ t(`provider.${account.info.provider}`) }}</span>
          <span class="min-w-0 truncate font-medium" :title="identity(account)" data-testid="ai-usage-name">{{ account.info.label }}</span>
          <span v-if="account.info.plan" class="text-muted-foreground flex-none text-xs" data-testid="ai-usage-plan">{{ account.info.plan }}</span>
          <span v-if="account.resets" class="bg-secondary text-secondary-foreground flex-none rounded-sm px-1.5 py-px text-xs" :title="resetsHint(account)" data-testid="ai-usage-resets">
            {{ plural("panel.resets", account.resets.available) }}
          </span>
          <span class="flex-1" />
          <span v-if="stale(account)" class="text-warning flex flex-none items-center gap-1 text-xs" :title="t('panel.staleHint')" data-testid="ai-usage-stale">
            <Info class="size-3.5" :stroke-width="1.75" />{{ t("panel.stale") }}
          </span>
          <span class="text-muted-foreground flex-none text-xs">{{ updatedText(account) }}</span>
        </header>

        <ul v-if="account.reading?.windows.length" :class="cn('flex flex-col gap-1', stale(account) && 'opacity-70')">
          <li
            v-for="(window, position) in account.reading.windows"
            :key="position"
            class="grid grid-cols-[4.5rem_minmax(2rem,1fr)_5.5rem_7.5rem] items-center gap-x-2"
            :title="window.resetsAt ? t('panel.resetHint', { date: dateTime(window.resetsAt) }) : undefined"
            data-testid="ai-usage-window"
          >
            <span class="min-w-0 truncate">{{ windowLabel(window, t) }}</span>
            <div class="bg-muted h-1.5 overflow-hidden rounded-full" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="shown(window)" :aria-label="windowLabel(window, t)">
              <!-- The bar follows the chosen style; its colour always follows what is left. -->
              <div :class="cn('h-full rounded-full', TONE[barTone(leftPercent(window))])" :style="{ width: `${shown(window)}%` }" />
            </div>
            <span class="whitespace-nowrap tabular-nums">{{ t(settings.style === "used" ? "panel.used" : "panel.left", { percent: shown(window) }) }}</span>
            <span class="text-muted-foreground truncate whitespace-nowrap tabular-nums">{{ resetText(window.resetsAt) }}</span>
          </li>
        </ul>
        <p v-if="account.status !== 'ok'" class="text-muted-foreground text-xs" data-testid="ai-usage-state">{{ t(STATE_TEXT[account.status]) }}</p>
      </section>
    </div>

    <footer v-if="!monitor.denied.value" class="flex flex-none items-center justify-end gap-1 border-t px-2 py-1">
      <Button v-if="showSettings" size="xs" data-testid="ai-usage-settings-done" @click="showSettings = false">{{ t("settings.done") }}</Button>
      <template v-else>
        <Button variant="ghost" size="icon-xs" :title="t('panel.settings')" :aria-label="t('panel.settings')" data-testid="ai-usage-open-settings" @click="showSettings = true">
          <SettingsIcon :stroke-width="1.75" />
        </Button>
        <Button
          v-if="accounts.length"
          variant="ghost"
          size="icon-xs"
          :disabled="monitor.refreshing.value"
          :title="t('panel.refresh')"
          :aria-label="t('panel.refresh')"
          data-testid="ai-usage-refresh"
          @click="monitor.refreshNow()"
        >
          <RefreshCw :class="cn(monitor.refreshing.value && 'animate-spin')" :stroke-width="1.75" />
        </Button>
      </template>
    </footer>
  </div>
</template>
