import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cleanLinkCode, fingerprint, LINK_STATEMENT, LinkError, linkKey, linkRequest } from "./index.ts";

const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

describe("link codes", () => {
  it("read the code as Tavora shows it, also in small letters or with spaces", () => {
    expect(cleanLinkCode("ABCD-EFGH")).toBe("ABCDEFGH");
    expect(cleanLinkCode(" abcd efgh ")).toBe("ABCDEFGH");
    for (const bad of ["ABCD-EFG", "ABCD-EFGHJ", "ABCD-EF0H", "ABCD-EFIH", "<script>"]) expect(cleanLinkCode(bad)).toBeNull();
  });
});

describe("linkKey", () => {
  // The service checks exactly this text (apps/api publishers.ts); both sides pin it.
  it("signs the agreed statement", () => expect(LINK_STATEMENT).toBe("tavora-key-link-1"));

  it("sends the code, the public half and a signature only the key can make, and never the secret key", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const sent: { url: string; body: Record<string, string> }[] = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      sent.push({ url: String(url), body });
      const raw = Buffer.from(body.publicKey!, "base64");
      const publicKey = createPublicKey({ key: Buffer.concat([ED25519_SPKI, raw]), format: "der", type: "spki" });
      const ok = verify(null, Buffer.from(`tavora-key-link-1\n${body.code}`, "utf8"), publicKey, Buffer.from(body.signature!, "base64"));
      return Response.json(ok ? { status: "linked", fingerprint: fingerprint(publicKey), name: "example-dev" } : { reason: "bad-signature" }, { status: ok ? 200 : 400 });
    }) as typeof fetch;

    expect(await linkKey({ key: privateKey, code: "abcd-efgh", apiUrl: "https://api.example.test/", fetch: fakeFetch })).toEqual({ fingerprint: fingerprint(privateKey), name: "example-dev" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://api.example.test/v1/publishers/link");
    expect(Object.keys(sent[0]!.body).sort()).toEqual(["code", "publicKey", "signature"]);
    expect(sent[0]!.body.code).toBe("ABCDEFGH");
    const secret = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("base64");
    expect(JSON.stringify(sent)).not.toContain(secret);
  });

  it("says plainly what went wrong", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const answer = (status: number, body: unknown) => (async () => Response.json(body, { status })) as unknown as typeof fetch;
    await expect(linkKey({ key: privateKey, code: "nope", fetch: answer(200, {}) })).rejects.toThrow(/not a link code/);
    await expect(linkKey({ key: privateKey, code: "ABCDEFGH", fetch: answer(400, { reason: "wrong-code" }) })).rejects.toThrow(/wrong or has expired/);
    await expect(linkKey({ key: privateKey, code: "ABCDEFGH", fetch: answer(409, { reason: "key-taken" }) })).rejects.toThrow(/another Tavora account/);
    await expect(linkKey({ key: privateKey, code: "ABCDEFGH", fetch: (async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch })).rejects.toBeInstanceOf(LinkError);
    // An answer about another key is not taken as a link of this one.
    await expect(linkKey({ key: privateKey, code: "ABCDEFGH", fetch: answer(200, { status: "linked", fingerprint: "0".repeat(32), name: "x" }) })).rejects.toThrow(/different key/);
  });

  it("builds the same request the service checks", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const request = linkRequest(privateKey, "ABCDEFGH");
    expect(verify(null, Buffer.from("tavora-key-link-1\nABCDEFGH"), publicKey, Buffer.from(request.signature, "base64"))).toBe(true);
    expect(Buffer.from(request.publicKey, "base64")).toHaveLength(32);
  });
});
