import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

// Reads a Codex profile's allowance through the Codex command line's own
// app-server, the way its desktop app does: a short-lived process on this PC,
// talking over private pipes. It only asks who is signed in and for the rate
// limits. No conversation or model request is made and the profile's login is
// never read here: Codex does that itself. Only this fixed command is run.

/** The Codex command was not found. */
export class CodexMissingError extends Error {
  constructor() {
    super("Codex command not found");
    this.name = "CodexMissingError";
  }
}

export interface CodexReading {
  /** False when the profile has no ChatGPT login. */
  signedIn: boolean;
  /** The login is an API key, which has no subscription allowance. */
  apiKey: boolean;
  /** The signed-in email as Codex reports it (unchecked; parseEmail cleans it), or null. */
  email: string | null;
  /** The `account/rateLimits/read` answer; parsed by ai-usage-parse. */
  limits: unknown;
}

/** The first Codex command on PATH (or in npm's global folder on Windows), or null. */
export function findCodex(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const names = platform === "win32" ? ["codex.exe", "codex.cmd"] : ["codex"];
  const dirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  if (platform === "win32" && env.APPDATA) dirs.push(path.join(env.APPDATA, "npm"));
  for (const dir of dirs) {
    for (const name of names) {
      const file = path.join(dir, name);
      if (existsSync(file)) return file;
    }
  }
  return null;
}

const ARGS = ["app-server", "--listen", "stdio://"];

function start(file: string, directory: string, env: NodeJS.ProcessEnv): ChildProcess {
  const options = { cwd: directory, env, windowsHide: true, stdio: "pipe" } as const;
  // A .cmd shim can only run through cmd.exe; the path is quoted and cannot contain a quote.
  if (/\.(cmd|bat)$/i.test(file)) {
    if (file.includes('"')) throw new CodexMissingError();
    return spawn(env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `""${file}" ${ARGS.join(" ")}"`], { ...options, windowsVerbatimArguments: true });
  }
  return spawn(file, ARGS, options);
}

function stop(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => undefined);
  else child.kill();
}

/** Asks the Codex command for the allowance of the profile in `directory`. Throws when it fails or `signal` aborts. */
export async function readCodexUsage(directory: string, version: string, signal: AbortSignal): Promise<CodexReading> {
  const file = findCodex();
  if (!file) throw new CodexMissingError();
  // A profile uses its subscription login, never an API key the PC happens to have set.
  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: directory };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  const child = start(file, directory, env);
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const failAll = (error: Error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  child.on("error", (error) => failAll(error.message.includes("ENOENT") ? new CodexMissingError() : error));
  child.on("exit", () => failAll(new Error("Codex closed its connection")));
  child.stderr?.resume();
  const lines = createInterface({ input: child.stdout! });
  lines.on("line", (line) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof message !== "object" || message === null) return;
    const { id, result, error } = message as { id?: unknown; result?: unknown; error?: unknown };
    if (typeof id !== "number") return;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (error !== undefined) entry.reject(new Error("Codex could not answer"));
    else entry.resolve(result);
  });
  const onAbort = () => failAll(new Error("Codex did not answer in time"));
  signal.addEventListener("abort", onAbort, { once: true });

  let nextId = 0;
  const send = (value: unknown) => child.stdin!.write(`${JSON.stringify(value)}\n`);
  const call = (method: string, params: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      if (signal.aborted) return reject(new Error("Codex did not answer in time"));
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    });

  try {
    await call("initialize", { clientInfo: { name: "tavora", title: "Tavora", version } });
    send({ method: "initialized", params: {} });
    const identity = await call("account/read", { refreshToken: false });
    const account = typeof identity === "object" && identity !== null ? (identity as { account?: unknown }).account : null;
    if (typeof account !== "object" || account === null) return { signedIn: false, apiKey: false, email: null, limits: null };
    const email = (account as { email?: unknown }).email;
    if ((account as { type?: unknown }).type === "apiKey") return { signedIn: true, apiKey: true, email: null, limits: null };
    return { signedIn: true, apiKey: false, email: typeof email === "string" ? email : null, limits: await call("account/rateLimits/read", null) };
  } finally {
    signal.removeEventListener("abort", onAbort);
    lines.close();
    stop(child);
  }
}
