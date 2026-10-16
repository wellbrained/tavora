// Reads every account through the ai-usage connector while the panel is shown, one after the other,
// every 1 to 60 minutes (doubling after each failure, up to a day), and keeps the last good reading
// of each in the settings shared by every game, so it shows as Last known after a failure or a
// restart. Tavora reads each account at most once a minute for all panels together, so several
// open panels cost the provider nothing extra.

import type { AiUsageAccountInfo, AiUsageReading, JsonValue, TavoraSDK } from "@tavora/sdk";
import { TavoraError } from "@tavora/sdk";
import { ref, shallowRef } from "vue";
import {
  moved,
  nextWait,
  ordered,
  parseCodexResets,
  parseOrder,
  parseReadings,
  parseSettings,
  windowsOf,
  type Resets,
  type SavedReading,
  type Settings,
} from "./usage";

/** How often the panel looks for accounts that are due, and moves its countdowns. */
export const TICK_MS = 30_000;

/** waiting: not read yet in this panel; the rest is what the connector last said. */
export type AccountStatus = "waiting" | AiUsageReading["status"];

/** What one account shows. */
export interface AccountView {
  info: AiUsageAccountInfo;
  status: AccountStatus;
  reading: SavedReading | null;
  /** The signed-in email the provider reported; kept in memory only. */
  email: string | null;
  /** Codex's manual resets, from a fresh reading only: an old one would be a guess. */
  resets: Resets | null;
}

interface Runtime {
  status: AccountStatus;
  email: string | null;
  resets: Resets | null;
  failures: number;
  /** When the account may be read again on its own. */
  next: number;
  /** A provider's own wait time; the refresh button respects it too. */
  blockedUntil: number;
}

/** Keys in storage.app, the settings shared by every game. */
const KEYS = { settings: "settings", readings: "readings", order: "order" } as const;

export type Monitor = ReturnType<typeof createMonitor>;

export function createMonitor(sdk: TavoraSDK, now: () => number = Date.now) {
  const accounts = shallowRef<AccountView[]>([]);
  const settings = shallowRef<Settings>(parseSettings(null));
  const refreshing = ref(false);
  /** The player has not allowed the module to use the ai-usage connector. */
  const denied = ref(false);

  let infos: AiUsageAccountInfo[] = [];
  let order: string[] = [];
  let readings: Record<string, SavedReading> = {};
  const runtime = new Map<string, Runtime>();
  let suspended = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  function runtimeFor(id: string): Runtime {
    let state = runtime.get(id);
    if (!state) runtime.set(id, (state = { status: "waiting", email: null, resets: null, failures: 0, next: 0, blockedUntil: 0 }));
    return state;
  }

  function publish(): void {
    accounts.value = ordered(infos, order).map((info) => {
      const state = runtimeFor(info.id);
      return { info, status: state.status, reading: readings[info.id] ?? null, email: state.email, resets: state.status === "ok" ? state.resets : null };
    });
  }

  /** Another panel may have changed the settings or taken a reading: the saved ones win. */
  async function loadSaved(): Promise<void> {
    const [savedSettings, savedReadings, savedOrder] = await Promise.all([sdk.storage.app.get(KEYS.settings), sdk.storage.app.get(KEYS.readings), sdk.storage.app.get(KEYS.order)]);
    settings.value = parseSettings(savedSettings);
    const fresh = parseReadings(savedReadings);
    // A reading this panel took after the saved one stays.
    for (const [id, reading] of Object.entries(readings)) if ((fresh[id]?.fetchedAt ?? -1) < reading.fetchedAt) fresh[id] = reading;
    readings = fresh;
    order = parseOrder(savedOrder);
  }

  async function loadAccounts(): Promise<void> {
    try {
      infos = await sdk.connectors.aiUsage.accounts();
      denied.value = false;
    } catch (error) {
      if (error instanceof TavoraError && error.code === "PERMISSION_DENIED") {
        denied.value = true;
        infos = [];
        return;
      }
      throw error;
    }
    const known = new Set(infos.map((info) => info.id));
    for (const id of runtime.keys()) if (!known.has(id)) runtime.delete(id);
  }

  async function saveReadings(): Promise<void> {
    const known = new Set(infos.map((info) => info.id));
    const kept = Object.fromEntries(Object.entries(readings).filter(([id]) => known.has(id)));
    // Plain numbers and short names only, so it is JSON as it stands.
    await sdk.storage.app.set(KEYS.readings, kept as unknown as JsonValue);
  }

  async function readOne(info: AiUsageAccountInfo): Promise<void> {
    const state = runtimeFor(info.id);
    let reading: AiUsageReading;
    try {
      reading = await sdk.connectors.aiUsage.read(info.id);
    } catch (error) {
      if (error instanceof TavoraError && error.code === "PERMISSION_DENIED") denied.value = true;
      reading = { status: "unavailable", retryAfterMs: null, answer: null, email: null, plan: info.plan, readAt: new Date(now()).toISOString() };
    }
    const at = now();
    const windows = reading.status === "ok" ? windowsOf(info.provider, reading.answer) : [];
    // An answer with nothing recognisable in it is not a reading.
    const status: AccountStatus = reading.status === "ok" && windows.length === 0 ? "unavailable" : reading.status;
    state.status = status;
    state.email = reading.email;
    state.resets = status === "ok" && info.provider === "codex" ? parseCodexResets(reading.answer) : null;
    state.failures = status === "ok" ? 0 : Math.min(state.failures + 1, 6);
    state.next = at + nextWait(settings.value.refreshMinutes, state.failures, reading.retryAfterMs);
    state.blockedUntil = reading.retryAfterMs !== null ? at + reading.retryAfterMs : 0;
    info.plan = reading.plan;
    if (status === "ok") {
      const readAt = Date.parse(reading.readAt);
      readings = { ...readings, [info.id]: { fetchedAt: Number.isFinite(readAt) ? readAt : at, windows } };
      await saveReadings().catch(() => undefined);
    }
  }

  /** Reads the accounts `due` picks, one after the other. */
  async function readAll(due: (state: Runtime) => boolean): Promise<void> {
    if (refreshing.value || denied.value) return;
    refreshing.value = true;
    try {
      for (const info of ordered(infos, order)) {
        if (suspended) break;
        if (!infos.includes(info) || !due(runtimeFor(info.id))) continue;
        await readOne(info);
        publish();
      }
    } finally {
      refreshing.value = false;
      publish();
    }
  }

  async function tick(): Promise<void> {
    if (suspended || refreshing.value) return;
    await loadSaved().catch(() => undefined);
    publish();
    const at = now();
    await readAll((state) => state.next <= at);
  }

  return {
    accounts,
    settings,
    refreshing,
    denied,

    async start(): Promise<void> {
      await Promise.all([loadSaved(), loadAccounts()]);
      publish();
      timer = setInterval(() => void tick(), TICK_MS);
      void tick();
    },

    stop(): void {
      clearInterval(timer);
      timer = undefined;
      suspended = true;
    },

    suspend(): void {
      suspended = true;
    },

    resume(): void {
      suspended = false;
      void tick();
    },

    /** The player changed the accounts in Settings: show them, and read new ones at once. */
    async accountsChanged(): Promise<void> {
      await loadAccounts();
      publish();
      void tick();
    },

    /** The refresh button: reads every account now, except those a provider asked to leave alone for a while. */
    refreshNow(): Promise<void> {
      const at = now();
      return readAll((state) => state.blockedUntil <= at);
    },

    async setSettings(patch: Partial<Settings>): Promise<void> {
      const next = { ...settings.value, ...patch };
      settings.value = next;
      await sdk.storage.app.set(KEYS.settings, { refreshMinutes: next.refreshMinutes, style: next.style });
      // A shorter interval applies at once rather than after the wait already planned.
      if (patch.refreshMinutes !== undefined) {
        for (const state of runtime.values()) if (state.failures === 0) state.next = Math.min(state.next, now() + next.refreshMinutes * 60_000);
        void tick();
      }
    },

    async move(id: string, step: -1 | 1): Promise<void> {
      order = moved(
        ordered(infos, order).map((info) => info.id),
        id,
        step,
      );
      publish();
      await sdk.storage.app.set(KEYS.order, order);
    },

    /** Test hook: what the schedule knows about an account. */
    runtimeOf: (id: string): Readonly<Runtime> | undefined => runtime.get(id),
  };
}
