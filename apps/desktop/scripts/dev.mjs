// Development mode: the host UI is served by Vite with hot reload, and
// Tavora restarts by itself when the main process or a preload changes. A
// rebuilt module in the repo only reloads its panels. Tavora always starts in
// the background: minimized if it was, in front only if it was the active
// window, else behind the active one (src/main/background-window.ts).
// Release builds never use this; see TAVORA_DEV_SERVER in src/main/index.ts.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import electron from "electron";
import { context } from "esbuild";
import { build, createServer } from "vite";
import { buildFilterEngine } from "./filters.mjs";
import { rendererConfig, root, targets } from "./targets.mjs";

// `pnpm dev --port <n>` picks the port, so a process manager can decide it.
// `pnpm dev --check` builds everything once, the way a dev session does, and stops without starting Tavora: exit code
// 0 when the host, the main process and every repo module built, 1 when one did not. CI runs it on a clean checkout.
const { values } = parseArgs({ options: { port: { type: "string", default: "4000" }, check: { type: "boolean", default: false } }, strict: false });
const checkOnly = values.check === true;
if (checkOnly) {
  // A watch build that never finishes would otherwise keep CI waiting until the job's timeout.
  setTimeout(() => checkFailed("everything within 5 minutes"), 5 * 60_000).unref();
}

/** `--check`: a first build failed, so the check fails. Nothing has started Tavora, so plain exit is enough. */
function checkFailed(what) {
  console.error(`[dev] check failed: ${what} did not build`);
  process.exit(1);
}
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`[dev] --port must be a port number, got "${values.port}"`);
  process.exit(1);
}

const server = await createServer({
  configFile: rendererConfig,
  server: { host: "127.0.0.1", port, strictPort: true },
});
await server.listen();
const url = `http://127.0.0.1:${server.config.server.port}/`;
console.log(`[dev] host UI at ${url} (hot reload)`);

let app;
let restartTimer;
let stopping = false;
// How the last Tavora said its window looked when it quit; the next start matches it.
let windowLook;
// Tavora stopped by itself (a crash, or main code that fails to start): it starts again after the next good build.
let stopped = false;

function start() {
  app = spawn(electron, [root], {
    // The extra channel lets this script ask Tavora to quit cleanly, which
    // signals cannot do on Windows.
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    // Without ELECTRON_RUN_AS_NODE, which some shells (an agent's in T3 Code) set: Electron would start as plain Node.
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      TAVORA_DEV_SERVER: url,
      TAVORA_DEVTOOLS: process.env.TAVORA_DEVTOOLS ?? "1",
      TAVORA_DEV_WINDOW: windowLook ?? "behind",
    },
  });
  windowLook = undefined;
  stopped = false;
  const current = app;
  // Closing Tavora ends the dev session; a restart replaces the process. A
  // Tavora that stops with an error waits for the next build instead.
  current.on("exit", (code) => {
    if (app !== current) return;
    if (code === 0 || code === null) return void stop(code ?? 0);
    console.log(`[dev] Tavora stopped (exit code ${code}); it starts again after the next successful build`);
    app = undefined;
    stopped = true;
  });
  current.on("message", (message) => {
    // Sent while quitting, when a restart has already let go of this process.
    if (typeof message === "object" && message !== null && typeof message.window === "string") windowLook = message.window;
    // Settings > Restart now asks this script, so Tavora stays under it.
    else if (message === "restart" && app === current) {
      console.log("[dev] restart requested by Tavora");
      restart();
    }
  });
}

/** Everything has built once: a dev session starts Tavora, `--check` is done. */
function allBuilt() {
  if (!checkOnly) return start();
  console.log("[dev] check passed: the host, the main process and every repo module built");
  void stop(0);
}

/** A module in the repo was rebuilt: its open panels load the new build, without restarting Tavora. */
function moduleBuilt(dir) {
  if (stopped) return restart();
  if (app?.connected) app.send({ moduleBuilt: dir });
}

function restart() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (stopped) return start();
    const previous = app;
    if (!previous) return; // still restarting; the new start picks up this build
    app = undefined;
    previous.once("exit", start);
    quit(previous);
  }, 150);
}

// Each target reports when a build finishes. Tavora starts once all have
// built; after that, every successful rebuild restarts it.
let pending = targets.length;
const reload = {
  name: "restart-tavora",
  setup(build) {
    let first = true;
    build.onEnd((result) => {
      if (result.errors.length) {
        if (checkOnly && first) return checkFailed("the main process or a preload");
        return console.log("[dev] build failed; fix the error and save again");
      }
      if (first) {
        first = false;
        if (--pending === 0) allBuilt();
      } else if (pending === 0) {
        console.log("[dev] main process changed, restarting Tavora");
        restart();
      }
    });
  },
};

// The official modules (repo modules/) and the examples (repo examples/) are
// loaded from their built bundles, so they are built in watch mode too; an
// example left unbuilt showed up as a broken module in Settings. A rebuild
// reloads that module's panels with the new bundle.
const moduleProjects = ["../../modules", "../../examples"].flatMap((folder) => {
  const dir = path.resolve(root, folder);
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, "tavora.module.json")))
    .map((entry) => path.join(dir, entry.name));
});
pending += moduleProjects.length;

// One after another, each from its own folder: moduleConfig takes the project folder from the working directory, as
// `vite build` run in the project gives it. The config is read before build() answers; later rebuilds keep its paths.
// Node loads each vite.config.ts itself (configLoader "native"), and `pnpm dev` runs this script with
// --conditions=source, so `@tavora/pack/vite` comes from packages/pack/src: a fresh checkout has no dist to load, and
// an old dist would hide a change to moduleConfig.
const here = process.cwd();
const watchers = [];
for (const dir of moduleProjects) {
  const name = path.basename(dir);
  process.chdir(dir);
  let watcher;
  try {
    watcher = await build({
      configFile: path.join(dir, "vite.config.ts"),
      configLoader: "native",
      root: existsSync(path.join(dir, "src", "index.html")) ? path.join(dir, "src") : dir,
      logLevel: "warn",
      build: { watch: {} },
    });
  } finally {
    process.chdir(here);
  }
  let first = true;
  watcher.on("event", (event) => {
    if (event.code === "ERROR") {
      if (checkOnly && first) return checkFailed(`module ${name}`);
      console.log(`[dev] module ${name} failed to build; fix the error and save again`);
    }
    if (event.code !== "END") return;
    if (first) {
      first = false;
      if (--pending === 0) allBuilt();
    } else if (pending === 0) {
      console.log(`[dev] module ${name} changed, reloading its panels`);
      moduleBuilt(dir);
    }
  });
  watchers.push(watcher);
}

// The Browser panel's ad blocker loads a compiled engine; the lists only change by hand.
await buildFilterEngine();

const contexts = await Promise.all(targets.map((options) => context({ ...options, plugins: [reload] })));
await Promise.all(contexts.map((ctx) => ctx.watch()));

/**
 * Ends a Tavora and everything it started. On Windows `child.kill()` ends only the main process, and a restart must
 * leave no window of the old one behind (overlays over a game), so the whole tree goes.
 */
function kill(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGKILL");
}

/** Asks Tavora to quit, saving its state; ends it for good if it does not. */
function quit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const timer = setTimeout(() => kill(child), 3000);
  child.once("exit", () => clearTimeout(timer));
  if (child.connected) child.send("quit");
  else child.kill();
}

async function stop(code) {
  if (stopping) return;
  stopping = true;
  clearTimeout(restartTimer);
  if (app && app.exitCode === null && app.signalCode === null) {
    const exited = new Promise((resolve) => app.once("exit", resolve));
    quit(app);
    await exited;
  }
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
  await Promise.all(watchers.map((watcher) => watcher.close()));
  await server.close();
  process.exit(code);
}

// Whatever ends this script, the Tavora under it goes too.
process.on("exit", () => {
  if (app) kill(app);
});
process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));
