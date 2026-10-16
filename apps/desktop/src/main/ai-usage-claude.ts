import { findCli, profileEnv, startCli, stopCli } from "./ai-usage-cli";
import { parseEmail } from "./ai-usage-parse";

// The signed-in email of a Claude profile, as `claude auth status` reports it, the way AI SubHub
// reads it. Only this fixed command runs, with the profile's folder set and no API key; nothing
// but the email comes out of it, and that only when Claude says the profile is signed in.

const ARGS = ["auth", "status"];
/** The answer is a few hundred bytes; anything far bigger is not it. */
const MAX_OUTPUT = 64 * 1024;

/** The email from `claude auth status` output: only when it says signed in, and only a plain address. */
export function parseClaudeStatus(output: string): string | null {
  try {
    const status: unknown = JSON.parse(output);
    if (typeof status !== "object" || status === null || (status as { loggedIn?: unknown }).loggedIn !== true) return null;
    return parseEmail((status as { email?: unknown }).email);
  } catch {
    return null;
  }
}

/** Asks the Claude command line who is signed in to the profile in `directory`; null when it is not installed, fails or is slow. */
export function readClaudeEmail(directory: string, timeoutMs = 5_000): Promise<string | null> {
  const file = findCli({ win32: ["claude.exe", "claude.cmd"], other: ["claude"] });
  if (!file) return Promise.resolve(null);
  return new Promise((resolve) => {
    let output = "";
    let child: ReturnType<typeof startCli>;
    try {
      child = startCli(file, ARGS, { cwd: directory, env: profileEnv("claude", directory) });
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => {
      stopCli(child);
      resolve(null);
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > MAX_OUTPUT) stopCli(child);
    });
    child.stderr?.resume();
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 && output.length <= MAX_OUTPUT ? parseClaudeStatus(output) : null);
    });
  });
}
