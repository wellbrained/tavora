import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAME_FRESH_MS, PublisherNames } from "./publisher-names";

const KEY = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";

async function setup(answers: Record<string, () => Response>, online = true) {
  const file = path.join(await mkdtemp(path.join(os.tmpdir(), "tavora-publishers-")), "publisher-names.json");
  const asked: string[] = [];
  const clock = { now: Date.parse("2026-10-17T12:00:00Z") };
  let changes = 0;
  const names = new PublisherNames({
    file,
    baseUrl: "https://api.test/",
    fetch: (async (input: string | URL | Request) => {
      const url = String(input);
      asked.push(url);
      const answer = answers[url.replace("https://api.test/v1/publishers/", "")];
      return answer ? answer() : Response.json({ reason: "unknown" }, { status: 404 });
    }) as typeof fetch,
    online: () => online,
    onChange: () => void changes++,
    now: () => clock.now,
  });
  await names.load();
  return { names, asked, clock, file, changes: () => changes };
}

describe("publisher names", () => {
  it("asks the service once a day per key, keeps the answer on the PC, and says when a name changed", async () => {
    const { names, asked, clock, file, changes } = await setup({ [KEY]: () => Response.json({ name: "example-dev" }) });
    await names.refresh([KEY, OTHER, KEY]);
    expect(asked).toEqual([`https://api.test/v1/publishers/${KEY}`, `https://api.test/v1/publishers/${OTHER}`]);
    expect(names.name(KEY)).toBe("example-dev");
    expect(names.name(OTHER)).toBeNull();
    expect(changes()).toBe(1);
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ [KEY]: { name: "example-dev" }, [OTHER]: { name: null } });

    await names.refresh([KEY, OTHER]);
    expect(asked).toHaveLength(2);
    clock.now += NAME_FRESH_MS;
    await names.refresh([KEY]);
    expect(asked).toHaveLength(3);
  });

  it("asks nothing while online features are off, and never for local or official modules", async () => {
    const off = await setup({}, false);
    await off.names.refresh([KEY]);
    expect(off.asked).toEqual([]);
    const on = await setup({});
    await on.names.refresh(["local", "official", "../etc", "x".repeat(32)]);
    expect(on.asked).toEqual([]);
  });

  it("keeps what it knew when the service cannot be reached, and shows only plain names", async () => {
    const { names, clock, file } = await setup({ [KEY]: () => Response.json({ name: "example-dev" }), [OTHER]: () => Response.json({ name: "evil‮<b>name</b>" }) });
    await names.refresh([KEY, OTHER]);
    expect(names.name(OTHER)).toBeNull();
    clock.now += NAME_FRESH_MS;
    const later = new PublisherNames({ file, baseUrl: "https://api.test", fetch: (async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch, online: () => true, onChange: () => {}, now: () => clock.now });
    await later.load();
    await later.refresh([KEY]);
    expect(later.name(KEY)).toBe("example-dev");
  });

  it("reads a damaged file as empty, and drops entries that are off", async () => {
    const { file } = await setup({});
    await writeFile(file, JSON.stringify({ [KEY]: { name: "fine-name", checkedAt: 1 }, "not-a-key": { name: "x", checkedAt: 1 }, [OTHER]: { name: "<script>", checkedAt: 1 } }));
    const names = new PublisherNames({ file, baseUrl: "https://api.test", fetch: fetch, online: () => false, onChange: () => {} });
    await names.load();
    expect(names.name(KEY)).toBe("fine-name");
    expect(names.name(OTHER)).toBeNull();
  });
});
