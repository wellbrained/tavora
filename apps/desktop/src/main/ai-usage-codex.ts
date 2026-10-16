import type { ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { findCli, profileEnv, startCli, stopCli } from "./ai-usage-cli";

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

const ARGS = ["app-server", "--listen", "stdio://"];

/** Asks the Codex command for the allowance of the profile in `directory`. Throws when it fails or `signal` aborts. */
export async function readCodexUsage(directory: string, version: string, signal: AbortSignal): Promise<CodexReading> {
  const file = findCli({ win32: ["codex.exe", "codex.cmd"], other: ["codex"] });
  if (!file) throw new CodexMissingError();
  // A profile uses its subscription login, never an API key the PC happens to have set.
  let child: ChildProcess;
  try {
    child = startCli(file, ARGS, { cwd: directory, env: profileEnv("codex", directory) });
  } catch {
    throw new CodexMissingError();
  }
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
    stopCli(child);
  }
}
