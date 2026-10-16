import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// Starting the Claude and Codex command lines for the AI Usage connector: found on PATH, run with
// fixed arguments and no shell, so nothing from a profile or a module can reach a command line.

/** The first of `names` on PATH (or in npm's global folder and Claude's own install folder on Windows), or null. */
export function findCli(names: { win32: string[]; other: string[] }, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const files = platform === "win32" ? names.win32 : names.other;
  const dirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  if (platform === "win32" && env.APPDATA) dirs.push(path.join(env.APPDATA, "npm"));
  if (env.USERPROFILE ?? env.HOME) dirs.push(path.join((env.USERPROFILE ?? env.HOME)!, ".local", "bin"));
  for (const dir of dirs) {
    for (const name of files) {
      const file = path.join(dir, name);
      if (existsSync(file)) return file;
    }
  }
  return null;
}

/**
 * Starts a command with fixed arguments. A .cmd shim can only run through cmd.exe; the path is
 * quoted and may not contain a quote, and the arguments are Tavora's own constants.
 */
export function startCli(file: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }): ChildProcess {
  const settings = { ...options, windowsHide: true, stdio: "pipe" } as const;
  if (/\.(cmd|bat)$/i.test(file)) {
    if (file.includes('"')) throw new Error("unusable command path");
    return spawn(options.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `""${file}" ${args.join(" ")}"`], { ...settings, windowsVerbatimArguments: true });
  }
  return spawn(file, [...args], settings);
}

/** Ends a command and whatever it started. */
export function stopCli(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => undefined);
  else child.kill();
}

/** Variables that would make a command line bill an API key or another provider instead of the profile's subscription. */
const OVERRIDES = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_SECURESTORAGE_CONFIG_DIR",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "CODEX_API_KEY",
];

/** The environment for a profile's command line: its folder set, every billing override removed. */
export function profileEnv(provider: "claude" | "codex", directory: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env, [provider === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME"]: directory };
  for (const key of OVERRIDES) delete result[key];
  return result;
}
