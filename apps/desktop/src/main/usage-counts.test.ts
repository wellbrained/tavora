import { describe, expect, it } from "vitest";
import { countAppUpdate } from "./usage-counts";

describe("countAppUpdate", () => {
  it("sends only the version, with nothing that identifies the player", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response(null, { status: 204 }))) as unknown as typeof fetch;
    await countAppUpdate({ baseUrl: "https://api.test/", fetchImpl }, "0.21.29");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.test/v1/app/updated");
    expect(calls[0]!.init).toMatchObject({ method: "POST", credentials: "omit", referrerPolicy: "no-referrer", body: JSON.stringify({ version: "0.21.29" }) });
    expect(Object.keys(calls[0]!.init.headers as Record<string, string>)).toEqual(["Content-Type"]);
  });

  it("sends nothing for a made-up version and never throws when offline", async () => {
    let sent = 0;
    const fetchImpl = (async () => (sent++, Promise.reject(new TypeError("offline")))) as unknown as typeof fetch;
    await countAppUpdate({ fetchImpl }, "latest");
    expect(sent).toBe(0);
    await expect(countAppUpdate({ fetchImpl }, "0.21.29")).resolves.toBeUndefined();
    expect(sent).toBe(1);
  });
});
