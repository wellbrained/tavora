// Measures what the System info connector (src/main/system-info.ts) costs: the real reader, in plain Node,
// watching every part of this PC at once. Run it on Windows:
//
//   pnpm perf:system-info                         one second, 60 seconds
//   pnpm perf:system-info --interval 5000 --seconds 120
//   pnpm perf:system-info --blocks gpu --seconds 30    only some parts: cpu,gpu,ram,drives,tavora (default all)
//
// It prints the time of one look at the PC (average, 95th percentile, worst), how much of the whole PC this process
// used (CPU time over wall time over logical processors), and how much memory grew. The budget is 1 % of the PC on
// average at one second, and 50 MB. Tavora's own figure comes from Electron in the app; here Node's own stands in.
import { build } from "esbuild";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? Number(process.argv[at + 1]) : fallback;
}
const intervalMs = option("interval", 1000);
const seconds = option("seconds", 60);
const blockNames = process.argv.includes("--blocks") ? process.argv[process.argv.indexOf("--blocks") + 1].split(",").map((name) => name.trim()).filter(Boolean) : ["cpu", "gpu", "ram", "drives", "tavora"];
const unknownBlocks = blockNames.filter((name) => !["cpu", "gpu", "ram", "drives", "tavora"].includes(name));
if (unknownBlocks.length) {
  console.error(`Unknown block: ${unknownBlocks.join(", ")} (use cpu, gpu, ram, drives, tavora)`);
  process.exit(1);
}
if (process.platform !== "win32") {
  console.log("This measures Windows' counters; nothing to do on this system.");
  process.exit(0);
}

// The reader is TypeScript with a few workspace imports: bundle it next to koffi, which stays outside as in the app.
const outfile = path.join(root, "out", "perf-system-info.cjs");
await build({
  stdin: {
    contents: 'export * from "./src/main/system-info"; export * from "./src/main/system-info-windows"; export * from "./src/main/system-info-parse";',
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  conditions: ["source"],
  external: ["koffi"],
  outfile,
  logLevel: "warning",
});
const { SystemMonitor, windowsSystemProbe, parseWatch } = createRequire(import.meta.url)(outfile);

const probe = windowsSystemProbe();
// One look is one run of the monitor's timer; the regular timer is timed from outside.
const looks = [];
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (callback, ms, ...args) =>
  realSetInterval(() => {
    const started = performance.now();
    callback(...args);
    looks.push(performance.now() - started);
  }, ms, ...args);
let lastCpu = process.cpuUsage();
let lastAt = performance.now();
const monitor = new SystemMonitor({
  probe,
  tavora: () => {
    const used = process.cpuUsage(lastCpu);
    const now = performance.now();
    const share = ((used.user + used.system) / 1000 / (now - lastAt) / os.cpus().length) * 100;
    lastCpu = process.cpuUsage();
    lastAt = now;
    return { cpu: share, memoryBytes: process.memoryUsage().rss };
  },
  log: (message, error) => console.warn(message, error),
});

const info = monitor.info();
console.log(`CPU: ${info.cpu.model} (${info.cpu.threads} threads), RAM: ${(info.ramBytes / 2 ** 30).toFixed(1)} GB`);
const ways = new Map(probe.describeGpus().map((way) => [way.id, way.via]));
for (const gpu of info.gpus) console.log(`GPU: ${gpu.name} (${gpu.id}), ${gpu.dedicated ? "dedicated" : "shared"}, ${gpu.vramBytes === null ? "no own memory" : `${(gpu.vramBytes / 2 ** 30).toFixed(1)} GB`}, read through ${ways.get(gpu.id) === "nvml" ? "NVML" : "the Windows counters (every 5 s)"}`);
console.log(`Drives: ${info.drives.map((drive) => `${drive.id} ${drive.kind}${drive.label ? ` "${drive.label}"` : ""}`).join(", ") || "none"}`);

let snapshots = 0;
let steady = null;
let lastSnapshot = null;
const subscription = monitor.subscribe({
  snapshot: (snapshot) => {
    snapshots++;
    // After the first look, which loads Windows' libraries and opens the counters, is the steady state.
    if (snapshots === 2) steady = { cpu: process.cpuUsage(), at: performance.now() };
    lastSnapshot = snapshot;
  },
  drivesChanged: () => undefined,
});

if (global.gc) global.gc();
const rssBefore = process.memoryUsage().rss;
let rssMax = rssBefore;
const memoryTimer = realSetInterval(() => (rssMax = Math.max(rssMax, process.memoryUsage().rss)), 1000);

const cpuBefore = process.cpuUsage();
const startedWatching = performance.now();
subscription.watch(parseWatch({
    blocks: {
      cpu: blockNames.includes("cpu"),
      gpu: blockNames.includes("gpu"),
      ram: blockNames.includes("ram"),
      drives: blockNames.includes("drives") ? info.drives.map((drive) => drive.id) : [],
      tavora: blockNames.includes("tavora"),
    },
    intervalMs,
  }));
console.log(`Watching ${blockNames.join(", ")} every ${intervalMs} ms for ${seconds} s ...`);
await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const wall = performance.now() - startedWatching;
const cpuUsed = process.cpuUsage(cpuBefore);
const steadyUsed = steady ? process.cpuUsage(steady.cpu) : cpuUsed;
const steadyWall = steady ? performance.now() - steady.at : wall;
const rssAfter = process.memoryUsage().rss;
subscription.close();
clearInterval(memoryTimer);

const regular = [...looks].sort((a, b) => a - b);
const average = regular.reduce((sum, ms) => sum + ms, 0) / Math.max(1, regular.length);
const percentile = regular[Math.min(regular.length - 1, Math.floor(regular.length * 0.95))] ?? 0;
const cpuPercent = ((cpuUsed.user + cpuUsed.system) / 1000 / wall / os.cpus().length) * 100;
const steadyPercent = ((steadyUsed.user + steadyUsed.system) / 1000 / steadyWall / os.cpus().length) * 100;
const mb = (bytes) => (bytes / 2 ** 20).toFixed(1);

console.log("");
console.log(`Snapshots: ${snapshots}, looks timed: ${looks.length}`);
console.log(`One look: average ${average.toFixed(2)} ms, 95th percentile ${percentile.toFixed(2)} ms, worst ${(regular.at(-1) ?? 0).toFixed(2)} ms`);
console.log(`CPU: ${cpuPercent.toFixed(3)} % of the whole PC (${((cpuUsed.user + cpuUsed.system) / 1000).toFixed(0)} ms of CPU in ${(wall / 1000).toFixed(1)} s, ${os.cpus().length} logical processors)`);
console.log(`CPU after the first look: ${steadyPercent.toFixed(3)} % of the whole PC (${((steadyUsed.user + steadyUsed.system) / 1000).toFixed(0)} ms of CPU in ${(steadyWall / 1000).toFixed(1)} s)`);
console.log(`Memory: RSS ${mb(rssBefore)} MB before, ${mb(rssAfter)} MB after (growth ${mb(rssAfter - rssBefore)} MB), highest ${mb(rssMax)} MB`);
console.log(`Stopped: ${monitor.running ? "STILL RUNNING" : "nothing running"}`);
if (lastSnapshot) console.log(`Last snapshot: cpu ${lastSnapshot.cpu?.usage} %, ${lastSnapshot.cpu?.cores.length} cores, gpus ${JSON.stringify(lastSnapshot.gpus)}`);
process.exit(0);
