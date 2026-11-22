import { findUnsafeSwitch } from "./unsafe-switches";

/**
 * The startup gate: a packaged Tavora started with an unsafe switch tells the user and quits before any page or
 * port exists. Returns true when it quit (nothing below may run); `quit` is process.exit and may not return.
 */
export function quitOnUnsafeSwitches(options: { packaged: boolean; argv: readonly string[]; show: (message: string) => void; quit: () => void }): boolean {
  const unsafe = options.packaged ? findUnsafeSwitch(options.argv) : undefined;
  // A bare `--` is a switch too, named "".
  if (unsafe === undefined) return false;
  options.show(`Tavora was started with --${unsafe} and closed, as switches it doesn't know could let other programs into it. Start Tavora from its own shortcut or the Start menu.`);
  options.quit();
  return true;
}
