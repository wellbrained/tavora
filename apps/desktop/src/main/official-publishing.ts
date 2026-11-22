import type { KeyObject } from "node:crypto";
import path from "node:path";
import { fingerprint, loadExistingKey } from "@tavora/pack";
import type { OfficialPublishView } from "../shared/host-api";
import { translate, type Language } from "../shared/i18n";
import { officialPublishAllowed } from "./host-sender";
import { UserError } from "./messages";
import { PublishCancelled, type OfficialPublisher } from "./official-publish";
import type { OfficialKeyStore } from "./official-key-store";
import { loadTrustedSavedKey } from "./official-saved-key";
import type { OfficialUpdates } from "./official-updates";

/** Who may sign Tavora's own modules (official-updates.ts). */
export type OfficialTrust = Pick<OfficialUpdates, "keyTrusted" | "signerTrusted">;

/** What builds, signs and uploads a built-in module (official-publish.ts). */
export type OfficialPublisherPort = Pick<OfficialPublisher, "view" | "check" | "prepare" | "confirm" | "cancel">;

export interface OfficialPublishingOptions {
  /** This is a packaged build; built-in modules are published only from a development build. */
  packaged: boolean;
  /** Tavora's keys are pinned in this build (officialOn(OFFICIAL_PINS)). */
  pinsOn: boolean;
  /** The built-in pins, asked for each step (made only once publishing is allowed). */
  trust: () => OfficialTrust;
  /** The one publisher, made on first use and kept for the preview in between. */
  publisher: (trust: OfficialTrust) => OfficialPublisherPort;
  /** The Tavora key saved on this PC (sealed by the system). */
  keys: Pick<OfficialKeyStore, "load" | "forget" | "save" | "canRemember" | "hasKey">;
  /** The system's open dialog for a key file; undefined when the developer closed it. */
  pickKeyFile: () => Promise<string | undefined>;
  language: () => Language;
  /** Something the host UI shows changed. */
  changed: () => void;
}

/**
 * Publishing Tavora's built-in modules from a development build (official-publishing.ts): Settings > Development's
 * Built-in modules list, the build and preview of one module's update, and Sign and upload with the Tavora key. A
 * packaged build, or one without the pins, does none of it. The key is held only for the upload; a saved one that may
 * no longer sign is forgotten before it is used.
 */
export class OfficialPublishing {
  private publisher: OfficialPublisherPort | null = null;
  /** The list (state.officialPublish); the publish in progress is the publisher's. */
  private list: Pick<OfficialPublishView, "check" | "overview"> = { check: { phase: "idle" }, overview: null };

  constructor(private readonly options: OfficialPublishingOptions) {}

  /** What Settings > Development shows. */
  view(): OfficialPublishView {
    const available = this.allowed();
    return {
      available,
      ...this.list,
      run: this.run(),
      key: { saved: available && this.options.keys.hasKey(), canRemember: available && this.options.keys.canRemember() },
    };
  }

  /** Works out which built-in modules have something to publish. Not while a build runs: both fetch in the same checkout. */
  async check(): Promise<void> {
    const trust = this.trust();
    if (!trust || this.list.check.phase === "checking" || this.run().phase === "building") return;
    this.list = { ...this.list, check: { phase: "checking" } };
    this.options.changed();
    try {
      this.list = { check: { phase: "idle" }, overview: await this.publisherFor(trust).check() };
    } catch (error) {
      const message = error instanceof UserError ? translate(this.options.language(), error.key, error.params) : (error as Error).message;
      this.list = { ...this.list, check: { phase: "failed", error: message } };
    } finally {
      this.options.changed();
    }
  }

  /**
   * Builds a built-in module's update from origin/main and packs it for the preview, showing each step. Nothing is
   * signed here; the key is needed only for Sign and upload (`confirm`).
   */
  async prepare(moduleId: string): Promise<void> {
    const trust = this.trust();
    if (!trust) throw new UserError("officialPublish.error.notBuiltIn");
    if (this.run().phase !== "idle" || this.list.check.phase === "checking") throw new UserError("officialPublish.error.busy");
    const name = this.list.overview?.rows.find((row) => row.id === moduleId)?.name ?? moduleId;
    try {
      await this.publisherFor(trust).prepare(moduleId, undefined, name);
    } catch (error) {
      if (error instanceof PublishCancelled) return;
      throw error;
    }
  }

  /**
   * Signs the previewed build and uploads it. The key is the one saved on this PC, while it may still sign Tavora's
   * modules, or a key file the developer picks now; it is held only for this call. A picked key is saved (sealed by
   * the system) only when the developer asked for it and only once it is known to be Tavora's key. Answers with the
   * published id and version, or nothing when no key was picked.
   */
  async confirm(remember: boolean): Promise<string | void> {
    const trust = this.trust();
    const publisher = this.publisher;
    if (!trust || !publisher) throw new UserError("officialPublish.error.notPrepared");
    const published = await publisher.confirm(() => this.key(trust, remember));
    if (!published) return;
    void this.check();
    return `${published.id} ${published.version}`;
  }

  /** Stops the build in progress (its own catch ends the run) or throws the preview away. */
  async cancel(): Promise<void> {
    // Sign and upload, once pressed, can't be stopped; the dialog stays until it is done (OfficialPublisher.cancel).
    await this.publisher?.cancel();
    this.options.changed();
  }

  async forgetKey(): Promise<void> {
    await this.options.keys.forget();
    this.options.changed();
  }

  /** Tavora quits: a worktree a cancel can't remove in time is swept on the next publish. */
  quit(): void {
    void this.publisher?.cancel();
  }

  private allowed(): boolean {
    return officialPublishAllowed(this.options.packaged, this.options.pinsOn);
  }

  /**
   * Who may sign Tavora's own modules, for publishing from a dev build: the built-in pins. A dev build never loads
   * downloaded copies (resolveOfficialPins), but it publishes under the same key and account as the catalogue checks.
   * Null in a packaged build or while the pins are empty.
   */
  private trust(): OfficialTrust | null {
    return this.allowed() ? this.options.trust() : null;
  }

  private publisherFor(trust: OfficialTrust): OfficialPublisherPort {
    this.publisher ??= this.options.publisher(trust);
    return this.publisher;
  }

  private run() {
    return this.publisher?.view() ?? { phase: "idle" as const };
  }

  /** The key for Sign and upload: the saved one, or a key file picked now (null when none is picked). */
  private async key(trust: OfficialTrust, remember: boolean): Promise<KeyObject | null> {
    const keys = this.options.keys;
    // A saved key that may no longer sign (revoked, or the pins moved on) is not kept.
    let key = await loadTrustedSavedKey(keys, (saved) => trust.keyTrusted(fingerprint(saved)), () => this.options.changed());
    if (!key) {
      const keyFile = await this.options.pickKeyFile();
      if (!keyFile) return null;
      key = await loadExistingKey(path.resolve(keyFile)).then(
        ({ key: loaded }) => loaded,
        (error: unknown) => {
          throw new UserError("officialPublish.error.key", { message: (error as Error).message.replace(/There is no publisher key at .*/, "there is no key file there") });
        },
      );
      if (!trust.keyTrusted(fingerprint(key))) throw new UserError("officialPublish.error.wrongKey");
      if (remember && keys.canRemember()) {
        await keys.save(key).catch(() => {
          throw new UserError("officialPublish.error.remember");
        });
      }
    }
    return key;
  }
}
