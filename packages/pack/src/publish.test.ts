import { createHash, createPublicKey, generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PUBLISH_STATEMENT, PublishError, publishZip, signFiles, withdrawVersion, writeZip, type ZipFile } from "./index.ts";

function moduleZip(key: KeyObject | null): Buffer {
  const files: ZipFile[] = [{ name: "tavora.module.json", data: Buffer.from("{}") }];
  return writeZip(key ? [...files, signFiles(files, key)] : files);
}

describe("publishZip", () => {
  // The service checks exactly this text (apps/api catalog-publish.ts imports it from here).
  it("signs the agreed statement", () => expect(PUBLISH_STATEMENT).toBe("tavora-catalog-publish-1"));

  it("sends the zip with the key's signature over its hash and the publish token, and nothing else", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const zip = moduleZip(privateKey);
    const sent: { url: string; headers: Headers; body: Buffer }[] = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), headers: new Headers(init?.headers), body: Buffer.from(init?.body as Uint8Array) });
      return Response.json({ status: "published", id: "wellbrained.timer", version: "1.0.0", sha256: "ab" }, { status: 201 });
    }) as typeof fetch;

    // The key alone publishes nothing (decided 2026-10-20).
    await expect(publishZip({ key: privateKey, zip, fetch: fakeFetch })).rejects.toThrow(/TAVORA_PUBLISH_TOKEN/);
    expect(sent).toHaveLength(0);
    expect(await publishZip({ key: privateKey, zip, token: "tvp_token", language: "de", apiUrl: "https://api.example.test/", fetch: fakeFetch })).toEqual({ id: "wellbrained.timer", version: "1.0.0", sha256: "ab", status: "published", reasons: [] });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://api.example.test/v1/catalog/publish");
    expect(sent[0]!.headers.get("content-type")).toBe("application/zip");
    expect(sent[0]!.headers.get("authorization")).toBe("Bearer tvp_token");
    expect(sent[0]!.headers.get("accept-language")).toBe("de");
    expect(sent[0]!.body).toEqual(zip);
    const sha256 = createHash("sha256").update(zip).digest("hex");
    const signature = Buffer.from(sent[0]!.headers.get("x-tavora-signature")!, "base64");
    expect(verify(null, Buffer.from(`${PUBLISH_STATEMENT}\n${sha256}`), createPublicKey(privateKey), signature)).toBe(true);
  });

  it("tells a version that waits for review from one that is listed, with the reasons", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const zip = moduleZip(privateKey);
    const waiting = (async () =>
      Response.json({ status: "waiting", id: "wellbrained.timer", version: "1.0.0", sha256: "ab", reasons: [{ check: "first-module", text: "It's your first module.", detail: "private" }, { nope: true }] }, { status: 202 })) as unknown as typeof fetch;
    expect(await publishZip({ key: privateKey, zip, token: "tvp_token", fetch: waiting })).toEqual({
      id: "wellbrained.timer",
      version: "1.0.0",
      sha256: "ab",
      status: "waiting",
      reasons: [{ check: "first-module", text: "It's your first module." }],
    });
  });

  it("explains a banned account and a declined zip", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const refuse = (reason: string) => (async () => Response.json({ error: "x", reason }, { status: 403 })) as unknown as typeof fetch;
    await expect(publishZip({ key: privateKey, zip: moduleZip(privateKey), token: "tvp_token", fetch: refuse("banned") })).rejects.toThrow(/can't publish to the catalog any more.*catalog-rules/s);
    await expect(publishZip({ key: privateKey, zip: moduleZip(privateKey), token: "tvp_token", fetch: refuse("declined") })).rejects.toThrow(/declined this exact zip/);
  });

  it("withdraws a waiting version with the token only", async () => {
    const sha256 = "a".repeat(64);
    const sent: { url: string; method: string | undefined; auth: string | null }[] = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), method: init?.method, auth: new Headers(init?.headers).get("authorization") });
      return Response.json({ status: "withdrawn", id: "wellbrained.timer", version: "1.0.0", sha256 });
    }) as typeof fetch;
    await expect(withdrawVersion({ token: undefined, sha256, fetch: fakeFetch })).rejects.toThrow(/TAVORA_PUBLISH_TOKEN/);
    await expect(withdrawVersion({ token: "tvp_token", sha256: "nope", fetch: fakeFetch })).rejects.toThrow(/SHA-256/);
    expect(await withdrawVersion({ token: "tvp_token", sha256, apiUrl: "https://api.example.test", fetch: fakeFetch })).toEqual({ id: "wellbrained.timer", version: "1.0.0" });
    expect(sent).toEqual([{ url: `https://api.example.test/v1/catalog/waiting/${sha256}`, method: "DELETE", auth: "Bearer tvp_token" }]);
    const missing = (async () => Response.json({ error: "x", reason: "not-waiting" }, { status: 404 })) as unknown as typeof fetch;
    await expect(withdrawVersion({ token: "tvp_token", sha256, fetch: missing })).rejects.toThrow(/None of your versions/);
  });

  it("refuses before uploading a zip that is unsigned or signed with another key", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const other = generateKeyPairSync("ed25519").privateKey;
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return Response.json({});
    }) as unknown as typeof fetch;
    await expect(publishZip({ key: privateKey, zip: moduleZip(null), fetch: fakeFetch })).rejects.toThrow(/not signed/);
    await expect(publishZip({ key: privateKey, zip: moduleZip(other), fetch: fakeFetch })).rejects.toThrow(/another publisher key/);
    await expect(publishZip({ key: privateKey, zip: Buffer.from("nope"), fetch: fakeFetch })).rejects.toThrow(PublishError);
    expect(calls).toBe(0);
  });

  it("says plainly what went wrong", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const answer = (status: number, body: unknown) => (async () => Response.json(body, { status })) as unknown as typeof fetch;
    const zip = moduleZip(privateKey);
    const token = "tvp_token";
    await expect(publishZip({ key: privateKey, zip, token, fetch: answer(403, { reason: "key-not-linked" }) })).rejects.toThrow(/tavora-pack link/);
    await expect(publishZip({ key: privateKey, zip, token, fetch: answer(401, { reason: "sign-in-needed" }) })).rejects.toThrow(/publish token doesn.t work any more/);
    await expect(publishZip({ key: privateKey, zip, token, fetch: answer(409, { reason: "conflict", error: "wellbrained.timer already has 1.0.0; a new version must be newer." }) })).rejects.toThrow(/must be newer/);
    await expect(publishZip({ key: privateKey, zip, token, fetch: answer(500, {}) })).rejects.toThrow(/\(500\)/);
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(publishZip({ key: privateKey, zip, token, fetch: offline })).rejects.toThrow(/could not be reached/);
  });
});
