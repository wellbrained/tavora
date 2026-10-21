import { createPrivateKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { fingerprint, rawPublicKey, type Published } from "@tavora/pack";
import type { DeveloperKeysView } from "../shared/host-api";
import type { AccountKey } from "./account-key";
import { CopyError } from "./cloud-copy";
import { PlayerError } from "./messages";

// The developer's publisher keys, kept in the account's key vault (decided 2026-10-20, "one recovery key").
// Tavora makes a key or takes one from a file, links it to the account, and signs with it when the
// developer publishes from Tavora. Nothing outside Tavora can ask it to sign (the pack command's pipe was
// removed, decided 2026-10-21). A key leaves Tavora only when the developer exports it to a file, for
// publishing from CI.

/** At most this many keys in the vault; far more than anyone needs. */
const MAX_KEYS = 20;

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

  constructor(private readonly options: DeveloperKeysOptions) {}

  view(): DeveloperKeysView {
    return {
      status: this.status,
      keys: this.keys.map((kept) => ({ fingerprint: kept.fingerprint })),
      hasKey: this.options.accountKey.get() !== null,
      recoveryKey: this.recoveryKey,
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
  async create(): Promise<string> {
    const { privateKey } = generateKeyPairSync("ed25519");
    return this.keep(privateKey.export({ format: "pem", type: "pkcs8" }).toString());
  }

  /**
   * The key to move a lost one's modules to: the newest key kept here that is linked to the account
   * (`linked`, oldest first), or else a new key, made and linked now.
   */
  async replacementFor(old: string, linked: string[]): Promise<string> {
    const kept = new Set(this.keys.map((key) => key.fingerprint));
    const next = [...linked].reverse().find((fingerprint) => fingerprint !== old && kept.has(fingerprint));
    return next ?? (await this.create());
  }

  /** Takes a publisher key from a file the developer picked (one the pack command made before). */
  async add(text: string): Promise<string> {
    let key: KeyObject;
    try {
      key = createPrivateKey(text);
    } catch {
      throw new PlayerError("developerKeys.error.notKey");
    }
    if (key.asymmetricKeyType !== "ed25519") throw new PlayerError("developerKeys.error.notKey");
    return this.keep(key.export({ format: "pem", type: "pkcs8" }).toString());
  }

  /** Keeps a key in the vault and links it; its fingerprint. */
  private async keep(pem: string): Promise<string> {
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
    return added.fingerprint;
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
