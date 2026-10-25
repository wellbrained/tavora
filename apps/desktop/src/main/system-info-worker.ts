/**
 * The worker thread the system-info connector reads the PC in (system-info-thread.ts is the main process's side).
 * It holds the one SystemMonitor and its probe, and passes messages both ways: what the panels watch in, the
 * snapshots out. Tavora's own use is filled in by the main process, which alone can read it.
 */
import { parentPort } from "node:worker_threads";
import { SystemMonitor, type SystemSubscription } from "./system-info";
import type { FromWorker, ToWorker } from "./system-info-thread";
import { systemProbe } from "./system-info-windows";

const port = parentPort;
if (!port) throw new Error("system-info-worker runs only as a worker thread");

const post = (message: FromWorker) => port.postMessage(message);

const monitor = new SystemMonitor({
  probe: systemProbe(),
  tavora: () => ({ cpu: 0, memoryBytes: 0 }),
  log: (message, error) => post({ type: "log", message, error: error instanceof Error ? (error.stack ?? error.message) : String(error) }),
});
const subscriptions = new Map<number, SystemSubscription>();

port.on("message", (message: ToWorker) => {
  switch (message.type) {
    case "info":
      try {
        post({ type: "info", id: message.id, info: monitor.info() });
      } catch (error) {
        post({ type: "info", id: message.id, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    case "subscribe": {
      const { sub } = message;
      subscriptions.get(sub)?.close();
      subscriptions.set(
        sub,
        monitor.subscribe({
          snapshot: (snapshot) => post({ type: "snapshot", sub, snapshot }),
          drivesChanged: () => post({ type: "drivesChanged", sub }),
        }),
      );
      return;
    }
    case "watch":
      subscriptions.get(message.sub)?.watch(message.request);
      return;
    case "suspend":
      subscriptions.get(message.sub)?.setSuspended(message.suspended);
      return;
    case "close":
      subscriptions.get(message.sub)?.close();
      subscriptions.delete(message.sub);
      return;
  }
});
