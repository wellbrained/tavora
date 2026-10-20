import { createHash, createPrivateKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { fingerprint, MANIFEST_FILE, PublishError, rawPublicKey, readZip, SIGNATURE_FILE, signedBytes, verifyFiles, ZipError, type Published, type SignerAnswer, type SignerRequest } from "@tavora/pack";
import type { DeveloperKeysView, SignRequestView } from "../shared/host-api";
import type { AccountKey } from "./account-key";
import { CopyError } from "./cloud-copy";
import { PlayerError } from "./messages";

// The developer's publisher keys, kept in the account's key vault (decided 2026-10-20, "one recovery key").
// Tavora makes a key or takes one from a file, links it to the account, and signs with it for the pack
// command (signer-server.ts), and publishes for it, uploading with the account's sign-in. Every signature
// waits for the developer's click on what it signs: the module and its version, and whether it packs or
// publishes. A key leaves Tavora only when the developer exports it to a file, for publishing from CI.

/** At most this many keys in the vault; far more than anyone needs. */
const MAX_KEYS = 20;
/** How long a sign request waits for the click. */
export const SIGN_WAIT_MS = 2 * 60_000;
/** At most this many files in a package to sign, like a module zip may have. */
const MAX_FILES = 10_000;

export interface DeveloperKeysOptions {
  accountKey: AccountKey;
  account: {
    signedIn(): boolean;
    /** Links a key to the signed-in account. */
    link(key: KeyObject): Promise<void>;
    /** Signs the zip's publish statement with the key and uploads it with the account's sign-in. */
    publish(key: KeyObject, zip: Buffer): Promise<Published>;
  };
  onChange: (view: DeveloperKeysView) => void;
  /** Brings Tavora to the front: a sign request is waiting. */
  focus: () => void;
  signWaitMs?: number;
}

interface Kept {
  pem: string;
  key: KeyObject;
  publicKey: string;
  fingerprint: string;
}

export class DeveloperKeys {
  private status: DeveloperKeysView["status"] = "loading";
  private keys: Kept[] = [];
  private recoveryKey: string | null = null;
  private request: (SignRequestView & { resolve: (allowed: boolean) => void }) | null = null;
  private nextId = 1;

  constructor(private readonly options: DeveloperKeysOptions) {}

  view(): DeveloperKeysView {
    const request = this.request;
    return {
      status: this.status,
      keys: this.keys.map((kept) => ({ fingerprint: kept.fingerprint })),
      hasKey: this.options.accountKey.get() !== null,
      recoveryKey: this.recoveryKey,
      request: request ? { id: request.id, kind: request.kind, fingerprint: request.fingerprint, module: request.module } : null,
    };
  }

  private signedIn: boolean | null = null;

  /** Signed in or out: the keys are read again. */
  accountChanged(signedIn: boolean): void {
    if (signedIn === this.signedIn) return;
    this.signedIn = signedIn;
    void this.refresh();
  }

  /** Reads the keys the vault holds. Never throws: offline keeps what was read last. */
  async refresh(): Promise<void> {
    try {
      await this.load();
    } catch {
      if (this.status === "loading") this.status = "offline";
    }
    this.hadKey = this.options.accountKey.get() !== null;
    this.changed();
  }

  private async load(): Promise<void> {
    const accountKey = this.options.accountKey;
    if (!this.options.account.signedIn()) {
      this.set("signed-out", []);
      return;
    }
    if (!accountKey.get()) {
      this.set((await accountKey.exists()) ? "ask" : "none", []);
      return;
    }
    this.set("ready", parseKeys((await accountKey.content()).publisherKeys ?? []));
  }

  private set(status: DeveloperKeysView["status"], keys: Kept[]): void {
    this.status = status;
    this.keys = keys;
  }

  /** Makes a new publisher key, keeps it in the vault and links it to the account. */
  async create(): Promise<void> {
    const { privateKey } = generateKeyPairSync("ed25519");
    await this.keep(privateKey.export({ format: "pem", type: "pkcs8" }).toString());
  }

  /** Takes a publisher key from a file the developer picked (one the pack command made before). */
  async add(text: string): Promise<void> {
    let key: KeyObject;
    try {
      key = createPrivateKey(text);
    } catch {
      throw new PlayerError("developerKeys.error.notKey");
    }
    if (key.asymmetricKeyType !== "ed25519") throw new PlayerError("developerKeys.error.notKey");
    await this.keep(key.export({ format: "pem", type: "pkcs8" }).toString());
  }

  private async keep(pem: string): Promise<void> {
    await this.ensureAccountKey();
    const added = parseKeys([pem])[0]!;
    await guard(() =>
      this.options.accountKey.change((content) => {
        const current = parseKeys(content.publisherKeys ?? []);
        if (current.some((kept) => kept.fingerprint === added.fingerprint)) return content;
        if (current.length >= MAX_KEYS) throw new PlayerError("developerKeys.error.tooMany");
        return { ...content, publisherKeys: [...current.map((kept) => kept.pem), pem] };
      }),
    );
    await this.load().catch(() => undefined);
    this.changed();
    await this.options.account.link(added.key);
  }

  /** Links a kept key that isn't linked yet (linking failed when it was made). */
  async link(fingerprint: string): Promise<void> {
    const kept = this.keys.find((key) => key.fingerprint === fingerprint);
    if (!kept) throw new PlayerError("account.error.keyGone");
    await this.options.account.link(kept.key);
  }

  /** The key as a file's text, for publishing from CI. */
  exportKey(fingerprint: string): string {
    const kept = this.keys.find((key) => key.fingerprint === fingerprint);
    if (!kept) throw new PlayerError("account.error.keyGone");
    return kept.pem;
  }

  /** The recovery key typed in, when another PC made the account's key. */
  async enterKey(text: string): Promise<void> {
    await guard(() => this.options.accountKey.enter(text));
    await this.refresh();
  }

  showKey(): void {
    this.recoveryKey = this.options.accountKey.recoveryKey();
    this.changed();
  }

  /** The cloud copy may have made, taken or forgotten the account's key: read again when it did. */
  keyMaybeChanged(): void {
    const hasKey = this.options.accountKey.get() !== null;
    if (hasKey === this.hadKey) return;
    this.hadKey = hasKey;
    void this.refresh();
  }
  private hadKey = false;

  keySaved(): void {
    this.recoveryKey = null;
    this.changed();
  }

  /** The account has no key yet: it is made here, and its recovery key shown once. */
  private async ensureAccountKey(): Promise<void> {
    const accountKey = this.options.accountKey;
    if (accountKey.get()) return;
    if (!this.options.account.signedIn()) throw new PlayerError("account.error.signedOut");
    if (!accountKey.canKeep) throw new PlayerError("cloudCopy.error.cantKeep");
    const setUp = await guard(() => accountKey.setUp());
    if (setUp.status === "ask") {
      this.set("ask", []);
      this.changed();
      throw new PlayerError("developerKeys.error.needRecoveryKey");
    }
    if (setUp.created) this.recoveryKey = accountKey.recoveryKey();
  }

  // ── Signing for the pack command ───────────────────────────────────

  /** One request from the pack command (signer-server.ts). */
  async handle(request: SignerRequest): Promise<SignerAnswer> {
    if (!this.options.account.signedIn()) return { ok: false, reason: "signed-out" };
    if (!this.options.accountKey.get()) return { ok: false, reason: "no-recovery-key" };
    if (request.op === "keys") {
      await this.refresh();
      return { ok: true, keys: this.keys.map((kept) => ({ publicKey: kept.publicKey })) };
    }
    if (this.keys.length === 0) await this.refresh();
    if (request.op === "publish") return this.publish(request);
    const asked = packageRequest(request);
    if (!asked) return { ok: false, reason: "bad-request" };
    const kept = this.keys.find((key) => key.publicKey === asked.publicKey);
    if (!kept) return { ok: false, reason: "unknown-key" };
    if (this.request) return { ok: false, reason: "busy" };
    if (!(await this.ask({ kind: "package", fingerprint: kept.fingerprint, module: asked.module }))) return { ok: false, reason: "refused" };
    return { ok: true, signature: sign(null, asked.bytes, kept.key).toString("base64") };
  }

  /** A zip to publish, after the click: Tavora signs it and uploads it, signed in. */
  private async publish(request: Extract<SignerRequest, { op: "publish" }>): Promise<SignerAnswer> {
    const asked = publishRequest(request);
    if (!asked) return { ok: false, reason: "bad-request" };
    const kept = this.keys.find((key) => key.publicKey === asked.publicKey);
    if (!kept) return { ok: false, reason: "unknown-key" };
    if (this.request) return { ok: false, reason: "busy" };
    if (!(await this.ask({ kind: "publish", fingerprint: kept.fingerprint, module: asked.module }))) return { ok: false, reason: "refused" };
    try {
      return { ok: true, published: await this.options.account.publish(kept.key, asked.zip) };
    } catch (error) {
      if (error instanceof PublishError) return { ok: false, reason: "publish-refused", error: error.message };
      return { ok: false, reason: "failed" };
    }
  }

  /** The developer's click on the request. */
  answer(id: number, allowed: boolean): void {
    if (this.request?.id === id) this.request.resolve(allowed);
  }

  private ask(question: Omit<SignRequestView, "id">): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(false), this.options.signWaitMs ?? SIGN_WAIT_MS);
      const done = (allowed: boolean) => {
        clearTimeout(timer);
        this.request = null;
        this.changed();
        resolve(allowed);
      };
      this.request = { ...question, id: this.nextId++, resolve: done };
      this.changed();
      this.options.focus();
    });
  }

  private changed(): void {
    this.options.onChange(this.view());
  }
}

function parseKeys(pems: readonly string[]): Kept[] {
  return pems.flatMap((pem) => {
    try {
      const key = createPrivateKey(pem);
      if (key.asymmetricKeyType !== "ed25519") return [];
      return [{ pem, key, publicKey: rawPublicKey(key).toString("base64"), fingerprint: fingerprint(key) }];
    } catch {
      return [];
    }
  });
}

/** The account key's service errors as messages for the player. */
async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof CopyError)) throw error;
    if (error.reason === "signed-out") throw new PlayerError("account.error.signedOut");
    if (error.reason === "unreachable") throw new PlayerError("account.error.unreachable");
    if (error.reason === "unavailable") throw new PlayerError("account.error.unavailable");
    throw new PlayerError("error.generic");
  }
}

type Asked = { publicKey: string; bytes: Buffer; module: NonNullable<SignRequestView["module"]> };

/** What the manifest says about the module, shortened for the question. */
function moduleOf(manifest: Buffer): SignRequestView["module"] {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(manifest.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value.slice(0, 80) : null);
  const [id, name, version] = [text(raw.id), text(raw.name), text(raw.version)];
  return id && version ? { id, name: name ?? id, version } : null;
}

/** A package to sign: its file hashes, and its manifest, which must be the one those hashes name. */
function packageRequest(request: Extract<SignerRequest, { op: "sign-package" }>): Asked | null {
  if (typeof request.publicKey !== "string" || typeof request.manifest !== "string") return null;
  const files = request.files as unknown;
  if (typeof files !== "object" || files === null || Array.isArray(files)) return null;
  const entries = Object.entries(files as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_FILES || !entries.every(([, hash]) => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash))) return null;
  const manifest = Buffer.from(request.manifest, "base64");
  const hashes = files as Record<string, string>;
  if (hashes[MANIFEST_FILE] !== createHash("sha256").update(manifest).digest("hex")) return null;
  const module = moduleOf(manifest);
  if (!module) return null;
  return { publicKey: request.publicKey, bytes: signedBytes(request.publicKey, hashes), module };
}

/** A zip to publish: signed already by a kept key. */
function publishRequest(request: Extract<SignerRequest, { op: "publish" }>): { publicKey: string; zip: Buffer; module: NonNullable<SignRequestView["module"]> } | null {
  if (typeof request.zip !== "string") return null;
  const zip = Buffer.from(request.zip, "base64");
  let files;
  try {
    files = readZip(zip);
  } catch (error) {
    if (error instanceof ZipError) return null;
    throw error;
  }
  const verified = verifyFiles(files);
  if (!verified.ok || !verified.signed) return null;
  const signature = JSON.parse(files.find((file) => file.name === SIGNATURE_FILE)!.data.toString("utf8")) as { publicKey: string };
  const manifest = files.find((file) => file.name === MANIFEST_FILE);
  const module = manifest ? moduleOf(manifest.data) : null;
  if (!module) return null;
  return { publicKey: signature.publicKey, zip, module };
}
