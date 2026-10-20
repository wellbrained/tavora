import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fingerprint, packModule, PublishError, publishZip, rawPublicKey, readZip, signedBytes, SignerError, tavoraSigner, verifyFiles, type SignerAnswer, type SignerRequest } from "./index.ts";

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

/** A stand-in for Tavora's signer: answers each request with `answer`. */
async function fakeTavora(answer: (request: SignerRequest) => SignerAnswer): Promise<{ address: string; requests: SignerRequest[] }> {
  const dir = await mkdtemp(path.join(tmpdir(), "tavora-signer-"));
  const address = process.platform === "win32" ? `\\\\.\\pipe\\tavora-signer-test-${path.basename(dir)}` : path.join(dir, "signer.sock");
  const requests: SignerRequest[] = [];
  const server = createServer((socket) => {
    let text = "";
    socket.on("data", (chunk) => {
      text += chunk.toString("utf8");
      if (!text.includes("\n")) return;
      const request = JSON.parse(text) as SignerRequest;
      requests.push(request);
      socket.end(JSON.stringify(answer(request)));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(address, resolve));
  return { address, requests };
}

async function moduleFolder(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tavora-module-"));
  await mkdir(path.join(dir, "dist"));
  await writeFile(path.join(dir, "dist", "index.html"), "<p>hi</p>");
  const manifest = { id: "wellbrained.tracker", name: "Tracker", version: "1.0.0", apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: [] } };
  await writeFile(path.join(dir, "tavora.module.json"), JSON.stringify(manifest));
  return dir;
}

describe("tavoraSigner", () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const publicKey = rawPublicKey(privateKey).toString("base64");
  const honest = (request: SignerRequest): SignerAnswer => {
    if (request.op === "keys") return { ok: true, keys: [{ publicKey }] };
    if (request.op === "sign-package") return { ok: true, signature: sign(null, signedBytes(request.publicKey, request.files), privateKey).toString("base64") };
    return { ok: false, reason: "failed" };
  };

  it("is null when Tavora is not running", async () => {
    expect(await tavoraSigner({ address: path.join(tmpdir(), "no-tavora-here.sock") })).toBeNull();
  });

  it("packs a zip Tavora signed, sending the manifest along but never asking for the key", async () => {
    const tavora = await fakeTavora(honest);
    const signer = (await tavoraSigner({ address: tavora.address }))!;
    expect(signer.fingerprint).toBe(fingerprint(privateKey));
    const { zip } = await packModule(await moduleFolder(), signer);
    expect(verifyFiles(readZip(zip))).toEqual({ ok: true, owner: fingerprint(privateKey), signed: true });
    const request = tavora.requests[1]!;
    expect(request.op).toBe("sign-package");
    if (request.op === "sign-package") expect(JSON.parse(Buffer.from(request.manifest, "base64").toString("utf8")).id).toBe("wellbrained.tracker");
  });

  it("picks a key by fingerprint and says which ones there are", async () => {
    const other = rawPublicKey(generateKeyPairSync("ed25519").privateKey).toString("base64");
    const tavora = await fakeTavora(() => ({ ok: true, keys: [{ publicKey }, { publicKey: other }] }));
    await expect(tavoraSigner({ address: tavora.address })).rejects.toThrow(/--publisher/);
    const chosen = await tavoraSigner({ address: tavora.address, publisher: fingerprint(privateKey).slice(0, 8).toUpperCase() });
    expect(chosen?.publicKey).toBe(publicKey);
    await expect(tavoraSigner({ address: tavora.address, publisher: "ffff" })).rejects.toThrow(/no publisher key starting with ffff/);
  });

  it("explains a turned-down request", async () => {
    const tavora = await fakeTavora((request) => (request.op === "keys" ? { ok: true, keys: [{ publicKey }] } : { ok: false, reason: "refused" }));
    const signer = (await tavoraSigner({ address: tavora.address }))!;
    const failure = packModule(await moduleFolder(), signer);
    await expect(failure).rejects.toThrow(SignerError);
    await expect(failure).rejects.toThrow(/turned down/);
  });

  it("hands the zip to Tavora, which signs and uploads it signed in, and says why it was refused", async () => {
    const { zip } = await packModule(await moduleFolder(), privateKey);
    let refuse = false;
    const tavora = await fakeTavora((request) => {
      if (request.op === "keys") return { ok: true, keys: [{ publicKey }] };
      if (request.op !== "publish") return { ok: false, reason: "bad-request" };
      return refuse ? { ok: false, reason: "publish-refused", error: "wellbrained.tracker already has 1.0.0; a new version must be newer." } : { ok: true, published: { id: "wellbrained.tracker", version: "1.0.0", sha256: "x" } };
    });
    const signer = (await tavoraSigner({ address: tavora.address }))!;
    const nothing = (async () => {
      throw new Error("tavora-pack never uploads itself here");
    }) as unknown as typeof fetch;
    expect(await publishZip({ key: signer, zip, fetch: nothing })).toEqual({ id: "wellbrained.tracker", version: "1.0.0", sha256: "x" });
    const request = tavora.requests[1]!;
    expect(request.op === "publish" && Buffer.from(request.zip, "base64").equals(zip)).toBe(true);
    refuse = true;
    await expect(publishZip({ key: signer, zip, fetch: nothing })).rejects.toThrow(PublishError);
    await expect(publishZip({ key: signer, zip, fetch: nothing })).rejects.toThrow(/must be newer/);
  });
});
