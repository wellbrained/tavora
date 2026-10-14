// Development mode: the host UI is served by Vite with hot reload, and
// Tavora restarts by itself when the main process or a preload changes.
// Release builds never use this; see TAVORA_DEV_SERVER in src/main/index.ts.
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import electron from "electron";
import { context } from "esbuild";
import { createServer } from "vite";
import { rendererConfig, root, targets } from "./targets.mjs";

// `pnpm dev --port <n>` picks the port, so a tool like tracker can decide it.
const { values } = parseArgs({ options: { port: { type: "string", default: "4000" } }, strict: false });
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

function start() {
  app = spawn(electron, [root], {
    // The extra channel lets this script ask Tavora to quit cleanly, which
    // signals cannot do on Windows.
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    env: { ...process.env, TAVORA_DEV_SERVER: url, TAVORA_DEVTOOLS: process.env.TAVORA_DEVTOOLS ?? "1" },
  });
  const current = app;
  // Closing Tavora ends the dev session; a restart replaces the process.
  current.on("exit", (code) => {
    if (app === current) void stop(code ?? 0);
  });
}

function restart() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    console.log("[dev] main process changed, restarting Tavora");
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
      if (result.errors.length) return console.log("[dev] build failed; fix the error and save again");
      if (first) {
        first = false;
        if (--pending === 0) start();
      } else if (pending === 0) {
        restart();
      }
    });
  },
};

const contexts = await Promise.all(targets.map((options) => context({ ...options, plugins: [reload] })));
await Promise.all(contexts.map((ctx) => ctx.watch()));

/** Asks Tavora to quit, saving its state; kills it if it does not. */
function quit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const timer = setTimeout(() => child.kill(), 3000);
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
  await server.close();
  process.exit(code);
}

process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));
