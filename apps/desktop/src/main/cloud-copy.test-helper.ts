// Test helpers for the cloud copy: PCs with their own data folders, and the real account service in memory.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CloudCopy, copyRoots, ServiceStorage } from "./cloud-copy";

export const OWNER = "0123456789abcdef0123456789abcdef";

const dirs: string[] = [];
export async function cleanUp(): Promise<void> {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
}

/** A PC: its data folder, with a module files folder elsewhere that also holds the user's own files. */
export async function pc(files: Record<string, string> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tavora-copy-"));
  dirs.push(root);
  const userData = path.join(root, "data");
  const moduleFiles = path.join(root, "Pictures", "Tavora");
  for (const [name, content] of Object.entries(files)) {
    const file = name.startsWith("module-blobs/") ? path.join(moduleFiles, name.slice("module-blobs/".length)) : path.join(userData, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return { root, userData, moduleFiles, roots: copyRoots(userData, moduleFiles) };
}

/**
 * The real account service (apps/api), in memory. Loaded by a path the desktop typecheck does not follow:
 * the service is checked with its own settings (Node's types, no DOM).
 */
async function loadService() {
  const api = (file: string) => import(/* @vite-ignore */ new URL(`../../../api/src/${file}`, import.meta.url).href);
  const [{ AccountStore }, { createApp }, { CopyStore }, { buildDataset, writeDatabase }, { createTestInbox }, { createRateLimiter }] = await Promise.all(
    ["account-store.ts", "app.ts", "cloud-copy.ts", "dataset.ts", "mail.ts", "rate-limit.ts"].map(api),
  );
  return { AccountStore, createApp, CopyStore, buildDataset, writeDatabase, createTestInbox, createRateLimiter };
}

export async function service() {
  const { AccountStore, createApp, CopyStore, buildDataset, writeDatabase, createTestInbox, createRateLimiter } = await loadService();
  const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
  const roomy = () => createRateLimiter({ limit: 10_000, windowMs: 60_000 });
  const inbox = createTestInbox();
  const app = createApp({ db, rateLimiter: roomy(), accounts: { store: new AccountStore(":memory:"), mailer: inbox, codeRateLimiter: roomy(), verifyRateLimiter: roomy(), copies: new CopyStore(":memory:") } });
  const routes: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    routes.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
    return app.request(url, init) as Promise<Response>;
  }) as typeof fetch;
  const json = (route: string, body: unknown) => app.request(`http://tavora.test/v1/account${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await json("/code", { email: "me@example.com" });
  const code = /\n {4}(\d{6})\n/.exec(inbox.mails()[0]?.text ?? "")?.[1] ?? "";
  const { token } = (await (await json("/verify", { email: "me@example.com", code, create: true })).json()) as { token: string };
  /** Another sign-in of the same account: another PC. */
  const signIn = async (name: string) => {
    inbox.clear();
    await json("/code", { email: "me@example.com" });
    const again = /\n {4}(\d{6})\n/.exec(inbox.mails().at(-1)?.text ?? "")?.[1] ?? "";
    return ((await (await json("/verify", { email: "me@example.com", code: again, os: "windows", name })).json()) as { token: string }).token;
  };
  const client = () => new CloudCopy(new ServiceStorage({ baseUrl: "http://tavora.test/v1/account", fetch: fetchImpl, token: () => token }));
  return { client, routes, fetch: fetchImpl, token, signIn };
}

