// Command line switches the fuses don't cover. Each would open a debugging port into Tavora's pages, switch off
// their sandbox, site isolation (`--disable-features`) or web security, point the Browser at another proxy, resolver
// or certificate check, or move Chromium's own profile (`--user-data-dir`). Tavora never starts itself with them,
// so a packaged Tavora that gets one quits before any page or port exists; tests and `pnpm dev` (unpackaged) still
// pass some (host resolver rules).
export const UNSAFE_SWITCHES = [
  "remote-debugging-port",
  "remote-debugging-pipe",
  "remote-debugging-address",
  "inspect",
  "inspect-brk",
  "no-sandbox",
  "disable-gpu-sandbox",
  "disable-web-security",
  "disable-site-isolation-trials",
  "disable-features",
  "user-data-dir",
  "js-flags",
  "allow-file-access-from-files",
  "ignore-certificate-errors",
  "proxy-server",
  "proxy-pac-url",
  "host-rules",
  "host-resolver-rules",
  "load-extension",
];

/**
 * The first unsafe switch among the arguments Tavora was started with, or undefined.
 * Reads process.argv, never app.commandLine: Electron adds switches of its own there
 * (`--allow-file-access-from-files` among them), which made 0.17.3 refuse every start.
 * Chromium on Windows takes `--name`, `-name` and `/name`, each optionally `=value`.
 */
export function findUnsafeSwitch(argv: readonly string[]): string | undefined {
  for (const arg of argv) {
    const match = /^(?:--|-|\/)([a-z0-9-]+)(?:=|$)/i.exec(arg);
    const name = match?.[1]?.toLowerCase();
    if (name && UNSAFE_SWITCHES.includes(name)) return name;
  }
  return undefined;
}
