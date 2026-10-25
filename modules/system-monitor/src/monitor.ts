// The panel's link to Tavora's system-info connector: what this PC is, the newest numbers, the connection and its
// log of drops, and what the player chose. Tavora does the timing and pauses it while the panel is hidden, so there are no timers here. The numbers
// live in shallow refs and plain arrays: a snapshot replaces the old one whole, and only the text that changed is
// redrawn.
import { errorMessage } from "@tavora/official-ui";
import { TavoraError, type JsonValue, type SystemConnection, type SystemConnectionSettings, type SystemInfo, type SystemInterval, type SystemOutage, type SystemSnapshot, type TavoraSDK } from "@tavora/sdk";
import { markRaw, ref, shallowRef } from "vue";
import { createHistory, type History } from "./history";
import { APP_KEY, defaultPanel, parseApp, parsePanel, pickGpu, requestKey, toggleBlock, toggleSection, watchRequest, type AppSettings, type BlockId, type PanelSettings, type SectionId } from "./settings";

export type Status = "loading" | "ready" | "denied" | "empty" | "error";

export type Monitor = ReturnType<typeof createMonitor>;

const isDenied = (reason: unknown) => reason instanceof TavoraError && reason.code === "PERMISSION_DENIED";

export function createMonitor(sdk: TavoraSDK) {
  const status = ref<Status>("loading");
  const error = ref("");
  const info = shallowRef<SystemInfo | null>(null);
  const snapshot = shallowRef<SystemSnapshot | null>(null);
  /** The connection as of the last check; null before the first one. */
  const connection = shallowRef<SystemConnection | null>(null);
  /** The drops of the last 30 days, the newest first. */
  const outages = shallowRef<SystemOutage[]>([]);
  /** Whether Tavora watches the connection, and what it pings. */
  const connectionSettings = shallowRef<SystemConnectionSettings | null>(null);
  /** This Tavora is older than the connection watcher (0.21.10), so there is nothing to show. */
  const connectionMissing = ref(false);
  const app = shallowRef<AppSettings>(parseApp(null));
  const panel = shallowRef<PanelSettings>(defaultPanel());
  /** The last 5 minutes of CPU and GPU use, for the graphs. */
  const cpuHistory: History = markRaw(createHistory(app.value.intervalMs));
  const gpuHistory: History = markRaw(createHistory(app.value.intervalMs));
  const ramHistory: History = markRaw(createHistory(app.value.intervalMs));

  let watched = "";
  let stopped = false;

  /** Tells Tavora what to watch, if that changed. */
  async function watch(): Promise<void> {
    if (!info.value || status.value !== "ready") return;
    const request = watchRequest(info.value, app.value, panel.value);
    const key = requestKey(request);
    if (key === watched) return;
    watched = key;
    try {
      await sdk.connectors.systemInfo.watch(request);
    } catch (reason) {
      watched = "";
      fail(reason);
    }
  }

  function fail(reason: unknown): void {
    if (isDenied(reason)) status.value = "denied";
    else {
      status.value = "error";
      error.value = errorMessage(reason);
    }
  }

  async function readInfo(): Promise<void> {
    const read = await sdk.connectors.systemInfo.info();
    // Nothing to show on a PC Tavora can't read (not Windows): no processor name and nothing else.
    if (!read.cpu.model && read.gpus.length === 0 && read.drives.length === 0 && read.ramBytes <= 0) {
      status.value = "empty";
      return;
    }
    info.value = read;
    status.value = "ready";
  }

  /** The log of drops and the watcher's settings. An older Tavora has neither. */
  async function loadConnection(): Promise<void> {
    try {
      const [log, settings] = await Promise.all([sdk.connectors.systemInfo.connectionLog(), sdk.connectors.systemInfo.connectionSettings()]);
      outages.value = log.outages;
      connectionSettings.value = settings;
      connectionMissing.value = false;
    } catch (reason) {
      if (!isDenied(reason)) connectionMissing.value = true;
    }
  }

  async function refreshLog(): Promise<void> {
    try {
      outages.value = (await sdk.connectors.systemInfo.connectionLog()).outages;
    } catch {
      // The list stays as it was.
    }
  }

  const cleanup: (() => void)[] = [];

  async function start(): Promise<void> {
    const [storedApp, storedPanel] = await Promise.all([sdk.storage.app.get(APP_KEY), sdk.panel.getState()]);
    app.value = parseApp(storedApp);
    panel.value = parsePanel(storedPanel);
    cpuHistory.setInterval(app.value.intervalMs);
    gpuHistory.setInterval(app.value.intervalMs);
    ramHistory.setInterval(app.value.intervalMs);
    cleanup.push(
      sdk.connectors.systemInfo.onSnapshot((next) => {
        if (stopped) return;
        snapshot.value = next;
        if (next.connection) connection.value = next.connection;
        if (next.cpu) cpuHistory.push(next.cpu.usage);
        if (next.ram && next.ram.totalBytes > 0) ramHistory.push((next.ram.usedBytes / next.ram.totalBytes) * 100);
        const id = info.value ? pickGpu(info.value, panel.value.gpu) : null;
        const gpu = next.gpus?.find((entry) => entry.id === id);
        if (gpu) gpuHistory.push(gpu.usage);
      }),
      // The connection went down, changed or came back: show it at once, and read the log again.
      sdk.connectors.systemInfo.onConnectionChange((next) => {
        if (stopped) return;
        connection.value = next;
        void refreshLog();
      }),
      // A drive was plugged in or removed: ask again, then watch the drives the player picked.
      sdk.connectors.systemInfo.onDrivesChange(() => {
        void readInfo().then(watch, fail);
      }),
    );
    try {
      await readInfo();
      await watch();
      await loadConnection();
    } catch (reason) {
      fail(reason);
    }
  }

  /** After the player allowed System info or came back to the panel: try again where it had failed. */
  async function retry(): Promise<void> {
    if (status.value === "ready" || status.value === "loading") return;
    status.value = "loading";
    try {
      await readInfo();
      await watch();
      await loadConnection();
    } catch (reason) {
      fail(reason);
    }
  }

  function stop(): void {
    stopped = true;
    cleanup.splice(0).forEach((fn) => fn());
  }

  function setPanel(next: PanelSettings): void {
    if (next === panel.value) return;
    if (next.gpu !== panel.value.gpu) gpuHistory.clear();
    const showsLog = next.sections.connection && !panel.value.sections.connection;
    panel.value = next;
    if (showsLog) void loadConnection();
    void sdk.panel.setState(next as unknown as JsonValue).catch(() => undefined);
    void watch();
  }

  function saveApp(next: AppSettings): void {
    app.value = next;
    void sdk.storage.app.set(APP_KEY, next as unknown as JsonValue).catch(() => undefined);
    void watch();
  }

  return {
    status,
    error,
    info,
    snapshot,
    app,
    panel,
    cpuHistory,
    gpuHistory,
    ramHistory,
    connection,
    outages,
    connectionSettings,
    connectionMissing,
    start,
    retry,
    stop,
    toggleBlock: (id: BlockId) => setPanel(toggleBlock(panel.value, id)),
    toggleSection: (id: SectionId) => setPanel(toggleSection(panel.value, id)),
    /**
     * Sets whether the connection is watched and which address is pinged, for the whole PC. Call it straight from the
     * click that saves (Tavora wants one). Throws when Tavora refuses, for the dialog to say.
     */
    async setConnection(settings: { enabled: boolean; target: string }): Promise<void> {
      connectionSettings.value = await sdk.connectors.systemInfo.setConnectionSettings(settings);
    },
    async clearLog(): Promise<void> {
      try {
        await sdk.connectors.systemInfo.clearConnectionLog();
      } catch {
        // The list stays as it was.
      }
      await refreshLog();
    },
    setGpu: (id: string) => setPanel({ ...panel.value, gpu: id }),
    setInterval(intervalMs: SystemInterval): void {
      if (intervalMs === app.value.intervalMs) return;
      cpuHistory.setInterval(intervalMs);
      gpuHistory.setInterval(intervalMs);
      ramHistory.setInterval(intervalMs);
      saveApp({ ...app.value, intervalMs });
    },
    /** The player's own choice of drives; once saved, newly seen drives are not added to it. */
    setDrives(drives: string[]): void {
      saveApp({ ...app.value, drives });
    },
  };
}
