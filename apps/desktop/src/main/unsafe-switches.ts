// The command line switches a packaged Tavora takes: only the ones it is ever started with. Every other switch could
// open a debugging port into Tavora's pages (`--remote-debugging-*`, `--inspect*`), run code of someone else's
// (`--js-flags`, `--load-extension`), switch off the sandbox, site isolation or web security, point the Browser at
// another proxy, resolver or certificate check, write logs or Chromium's profile somewhere else, and Chromium has
// hundreds more, with new ones in every release. So a packaged Tavora started with any switch not listed here quits
// before any page or port exists. Tests and `pnpm dev` (unpackaged) pass their own (host resolver rules) and are not
// checked. The environment needs no gate: the fuses (check-fuses.mjs) make a packaged Tavora ignore
// ELECTRON_RUN_AS_NODE, NODE_OPTIONS and --inspect, and Tavora reads its own variables only when unpackaged (index.ts).
//
// Who starts a packaged Tavora, and with what:
// - Windows, from the Start menu, the desktop or the taskbar: nothing (the installer's shortcuts have no arguments).
// - The installer after an update (electron-updater, NSIS): `--updated`, and `--force-run` when it was asked to start it.
// - Tavora itself (app.relaunch) and a second start that hands over to the running one: the same arguments again.
export const ALLOWED_SWITCHES = ["updated", "force-run"];

/** The longest switch name the start-up message repeats. */
const MAX_SHOWN = 60;

/**
 * The first switch among the arguments Tavora was started with that it doesn't take, or undefined.
 * Reads process.argv, never app.commandLine: Electron adds switches of its own there
 * (`--allow-file-access-from-files` among them), which made 0.17.3 refuse every start.
 * Chromium on Windows takes `--name`, `-name` and `/name`, each optionally `=value`, any case; an argument that
 * starts with none of them is no switch (a link or a path) and is let through, as Chromium ignores it.
 */
export function findUnsafeSwitch(argv: readonly string[]): string | undefined {
  for (const arg of argv) {
    const match = /^(?:--|-|\/)([^=]*)/.exec(arg);
    if (!match) continue;
    const name = (match[1] ?? "").toLowerCase();
    if (!ALLOWED_SWITCHES.includes(name)) return name.slice(0, MAX_SHOWN);
  }
  return undefined;
}
