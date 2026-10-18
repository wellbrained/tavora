import { createHash, createPublicKey, generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PUBLISH_STATEMENT, PublishError, publishZip, signFiles, writeZip, type ZipFile } from "./index.ts";

function moduleZip(key: KeyObject | null): Buffer {
  const files: ZipFile[] = [{ name: "tavora.module.json", data: Buffer.from("{}") }];
  return writeZip(key ? [...files, signFiles(files, key)] : files);
}

describe("publishZip", () => {
  // The service checks exactly this text (apps/api catalog-publish.ts imports it from here).
  it("signs the agreed statement", () => expect(PUBLISH_STATEMENT).toBe("tavora-catalog-publish-1"));

  it("sends the zip with the key's signature over its hash, and nothing else", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const zip = moduleZip(privateKey);
    const sent: { url: string; headers: Headers; body: Buffer }[] = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), headers: new Headers(init?.headers), body: Buffer.from(init?.body as Uint8Array) });
      return Response.json({ status: "published", id: "wellbrained.timer", version: "1.0.0", sha256: "ab" }, { status: 201 });
    }) as typeof fetch;

    expect(await publishZip({ key: privateKey, zip, apiUrl: "https://api.example.test/", fetch: fakeFetch })).toEqual({ id: "wellbrained.timer", version: "1.0.0", sha256: "ab" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://api.example.test/v1/catalog/publish");
    expect(sent[0]!.headers.get("content-type")).toBe("application/zip");
    expect(sent[0]!.body).toEqual(zip);
    const sha256 = createHash("sha256").update(zip).digest("hex");
    const signature = Buffer.from(sent[0]!.headers.get("x-tavora-signature")!, "base64");
    expect(verify(null, Buffer.from(`${PUBLISH_STATEMENT}\n${sha256}`), createPublicKey(privateKey), signature)).toBe(true);
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
    await expect(publishZip({ key: privateKey, zip, fetch: answer(403, { reason: "key-not-linked" }) })).rejects.toThrow(/tavora-pack link/);
    await expect(publishZip({ key: privateKey, zip, fetch: answer(409, { reason: "conflict", error: "wellbrained.timer already has 1.0.0; a new version must be newer." }) })).rejects.toThrow(/must be newer/);
    await expect(publishZip({ key: privateKey, zip, fetch: answer(500, {}) })).rejects.toThrow(/\(500\)/);
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(publishZip({ key: privateKey, zip, fetch: offline })).rejects.toThrow(/could not be reached/);
  });
});
