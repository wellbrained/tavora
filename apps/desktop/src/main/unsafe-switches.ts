// The command line switches a packaged Tavora takes: the one it is started with, and the GPU troubleshooting ones a
// user may have put on a shortcut (Tavora has no setting for hardware acceleration). Every other switch could open a
// debugging port into Tavora's pages (`--remote-debugging-*`, `--inspect*`), run code of someone else's (`--js-flags`,
// `--load-extension`), switch off the sandbox (the GPU's too: `--disable-gpu-sandbox`, `--in-process-gpu`), site
// isolation or web security, point the Browser at another proxy, resolver or certificate check, write logs or
// Chromium's profile somewhere else, and Chromium has hundreds more, with new ones in every release. So a packaged
// Tavora started with any switch not listed here, or with a value its check refuses, quits before any page or port
// exists. Tests and `pnpm dev` (unpackaged) pass their own (host resolver rules) and are not checked. The environment
// is handled in UNSAFE_ENVIRONMENT below.
//
// Who starts a packaged Tavora, and with what:
// - Windows, from the Start menu, the desktop or the taskbar: nothing (the installer's shortcuts have no arguments),
//   or what the user added to a shortcut.
// - The installer after an update (electron-builder's NSIS StartApp): `--updated`.
// - Tavora itself (app.relaunch) and a second start that hands over to the running one: the same arguments again.
const noValue = (value: string | undefined) => value === undefined;
/** Each switch Tavora takes, and the values it takes with it. */
export const ALLOWED_SWITCHES: Readonly<Record<string, (value: string | undefined) => boolean>> = {
  updated: noValue,
  "disable-gpu": noValue,
  "disable-gpu-compositing": noValue,
  // A plain number such as 1.25, nothing else.
  "force-device-scale-factor": (value) => value !== undefined && /^\d{1,2}(?:\.\d{1,4})?$/.test(value) && Number(value) > 0,
};

/**
 * Variables Chromium and Electron read from the environment that a packaged Tavora drops at start (index.ts), before
 * it starts any helper process, the network service among them: `SSLKEYLOGFILE` would have the network service write
 * the keys of every TLS connection to a file, and Electron's logging ones write Chromium's log to a file of the
 * starter's choice. Electron reads the logging ones in its main process before Tavora's code runs, so there they
 * only stop reaching the processes started later. ELECTRON_RUN_AS_NODE and NODE_OPTIONS (like --inspect) need no
 * removal: the fuses (check-fuses.mjs) make a packaged Tavora ignore them. Tavora's own variables count only in an
 * unpackaged run (index.ts).
 */
export const UNSAFE_ENVIRONMENT = ["SSLKEYLOGFILE", "ELECTRON_ENABLE_LOGGING", "ELECTRON_LOG_FILE"];

/** Removes UNSAFE_ENVIRONMENT from `env` (process.env, which takes it out of the real environment too), in any case. */
export function clearUnsafeEnvironment(env: Record<string, string | undefined>): void {
  for (const key of Object.keys(env)) {
    if (UNSAFE_ENVIRONMENT.includes(key.toUpperCase())) delete env[key];
  }
}

/** The longest switch name the start-up message repeats. */
const MAX_SHOWN = 60;

/**
 * The first switch among the arguments Tavora was started with that it doesn't take (or takes, but not with that
 * value), or undefined.
 * Reads process.argv, never app.commandLine: Electron adds switches of its own there
 * (`--allow-file-access-from-files` among them), which made 0.17.3 refuse every start.
 * Chromium on Windows takes `--name`, `-name` and `/name`, each optionally `=value`, any case; an argument that
 * starts with none of them is no switch (a link or a path) and is let through, as Chromium ignores it.
 */
export function findUnsafeSwitch(argv: readonly string[]): string | undefined {
  for (const arg of argv) {
    // Chromium trims whitespace before it looks for a switch, so " --remote-debugging-port" is one too (audit run 7).
    const match = /^\s*(?:--|-|\/)([^=]*)(?:=(.*))?$/s.exec(arg);
    if (!match) continue;
    const name = (match[1] ?? "").toLowerCase();
    const allowed = Object.hasOwn(ALLOWED_SWITCHES, name) ? ALLOWED_SWITCHES[name] : undefined;
    if (!allowed?.(match[2])) return name.slice(0, MAX_SHOWN);
  }
  return undefined;
}
