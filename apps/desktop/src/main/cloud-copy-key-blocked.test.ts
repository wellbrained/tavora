// The cloud copy with its key file on this PC unreadable at start (a virus scan holds it, or its rights changed): the
// copy stays on and keeps every file, and Settings says why it doesn't sync (decided 2026-11-23, "a saved file that
// can't be read is never written over").
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudCopyView } from "../shared/host-api";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { CopySync } from "./cloud-copy-sync";

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return { ...real, readFile: vi.fn(real.readFile) };
});

const realReadFile = vi.mocked(readFile).getMockImplementation()!;
/** The files that can't be read right now. */
const busy = new Set<string>();

beforeEach(() => {
  busy.clear();
  vi.mocked(readFile).mockImplementation((async (file: string, options: never) => {
    if (busy.has(path.resolve(String(file)))) throw Object.assign(new Error("EBUSY: busy"), { code: "EBUSY" });
    return realReadFile(file, options);
  }) as never);
});
afterEach(async () => {
  busy.clear();
  vi.restoreAllMocks();
  await cleanUp();
});

const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };

type Service = Awaited<ReturnType<typeof service>>;
type Pc = Awaited<ReturnType<typeof pc>>;

function tavora(cloud: Service, at: Pc) {
  const views: CloudCopyView[] = [];
  const sync = new CopySync({
    userData: at.userData,
    enabled: true,
    files: { root: () => at.moduleFiles },
    account: { token: () => cloud.token, id: () => "me" },
    serviceUrl: "http://tavora.test/v1/account",
    fetch: cloud.fetch,
    encryptor,
    restart: () => undefined,
  });
  sync.attach({ flush: async () => undefined, onChange: (view) => views.push(view) });
  return { sync, views };
}

/** Every file in the data folder and what it holds. */
async function files(dir: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) if (entry.isFile()) found[entry.name] = String(await realReadFile(path.join(dir, entry.name), "utf8"));
  return found;
}

describe("the cloud copy's key file unreadable at start", () => {
  it("keeps the copy on and every file, and says why it doesn't sync", async () => {
    const cloud = await service();
    const at = await pc({ "library.json": "{}" });
    const first = tavora(cloud, at);
    await first.sync.beforeLoad();
    await first.sync.turnOn();
    expect(first.sync.view()).toMatchObject({ on: true });
    const before = await files(at.userData);
    expect(Object.keys(before)).toEqual(expect.arrayContaining(["account-key.json", "cloud-copy.json"]));

    // The next start: the key file is held.
    busy.add(path.resolve(at.userData, "account-key.json"));
    const next = tavora(cloud, at);
    await next.sync.beforeLoad();
    next.sync.start();
    expect(next.sync.view()).toMatchObject({ problem: "key-blocked", keyBlocked: true });
    expect(next.views.at(-1)).toMatchObject({ problem: "key-blocked" });
    // A sync meanwhile reads the key file again, and it is still held: nothing changes.
    await next.sync.sync();
    expect(next.sync.view()).toMatchObject({ problem: "key-blocked" });
    expect(await files(at.userData)).toEqual(before);

    // Readable again: the next sync takes the key, and the copy goes on as before.
    busy.clear();
    await next.sync.sync();
    next.sync.dispose();
    expect(next.sync.view()).toMatchObject({ on: true, problem: null, keyBlocked: false });
  });
});
