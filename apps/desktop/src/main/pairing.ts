import { randomBytes, timingSafeEqual } from "node:crypto";
import { lstat, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { PairingView } from "../shared/host-api";
import type { CopySync } from "./cloud-copy-sync";
import { CopyError } from "./cloud-copy";
import type { AccountKey } from "./account-key";
import { newPairingKey, openFromPc, pairingCode, pairingCommit, sealForPc, type PairingKey } from "./copy-crypto";
import { FOLDER_NAME } from "./copy-folder";
import { writeFileAtomic } from "./fsutil";
import { UserError } from "./messages";

// Approving a new PC from an old one (decided 2026-10-20, "one recovery key", step 4), so the user
// types the recovery key only when every PC is gone. The new PC asks; an old PC that has the account's key
// shows "Add <PC>?" with a code, the new PC shows the same code, and on Add the old PC sends the key
// sealed to the new PC's one-time key. Signed in, the messages go through Tavora's service
// (apps/api/src/pairing.ts); signed out with the cloud copy in a folder of the user's own, through files
// in that folder's pairing/ folder, which a sync app may take minutes to carry. Either way, what passes
// on the way opens nothing, and the matching codes show that nobody swapped a one-time key.
//
// Both users check the codes: the old PC sends nothing before Add, and the new PC keeps nothing before its
// own user says the codes match. Without that second check, whoever carries the messages (the service, or
// anyone who can write the folder) could answer as an "old PC" and plant a key of their own on the new PC.
//
// Each PC keeps what it saw when it took its step: the old PC the new PC's promise (commit) and its own answer,
// the new PC the old PC's key. Were the old PC to read the promise again later, whoever carries the messages could
// swap in a key of their own after seeing both real ones and search for one that gives the same code.

/** How long a request through the folder lasts: a sync app can be slow. */
export const FOLDER_PAIRING_MS = 24 * 60 * 60_000;
/**
 * How far the asking PC's clock may be ahead (a day: clocks that are off by hours, or a time zone set wrong). A request
 * in the folder that says it lasts longer than FOLDER_PAIRING_MS and this from now wasn't made by Tavora (anyone who can
 * write the folder can plant one): it is removed, never answered. One within it that stays can't hide others (`skip`).
 */
export const CLOCK_AHEAD_MS = 24 * 60 * 60_000;
/** How often a PC that asks looks for an answer. */
const ASK_EVERY_MS = { service: 3_000, folder: 5_000 };
/** How often a PC with the key looks for a PC that asks. */
const WATCH_EVERY_MS = 15_000;
/**
 * Answers that don't end with Add (No, no click, an error, a request that went away) count for an hour; with this many,
 * the PC answers no more until one is an hour old. Otherwise whoever carries the messages could ask again and again,
 * without anyone seeing a question or after a No, until the code this PC would show matches the one a new PC shows.
 */
export const MAX_OPEN_ANSWERS = 3;
export const OPEN_ANSWER_MS = 60 * 60_000;
/** How long an answered request may go without the new PC's key before this PC lets go of it and looks again. */
export const ANSWER_WAIT_MS = { service: 10 * 60_000, folder: 30 * 60_000 };
/** How long a new PC waits with no answer before it says to check the other PC. */
export const SLOW_ANSWER_MS = { service: 60_000, folder: 15 * 60_000 };
/** The notice that this PC answers no more for now shows at most this often. */
const TOO_MANY_NOTICE_MS = 5 * 60_000;

/** One request, as this PC may see it. */
export interface PairingRequest {
  id: string;
  /** This PC asked. */
  own: boolean;
  name: string | null;
  /** base64url, for every key and the sealed key. */
  commit: string;
  expiresAt: number;
  answer?: { name: string | null; publicKey: string };
  reveal?: string;
  sealed?: string;
  declined?: boolean;
}

/** Where the messages go: Tavora's service, or the cloud copy's folder. */
export interface PairingTransport {
  readonly via: "service" | "folder";
  /**
   * The request this PC asked, or one it may answer (or answered); null when there is none. Of several, none in `skip`
   * (requests this PC turned down or let go of), so one that stays can't hide the others.
   */
  read(skip?: ReadonlySet<string>): Promise<PairingRequest | null>;
  ask(commit: string): Promise<{ id: string; expiresAt: number }>;
  /** False when another PC answered first. */
  answer(id: string, publicKey: string): Promise<boolean>;
  reveal(id: string, publicKey: string): Promise<void>;
  sendKey(id: string, sealed: string): Promise<void>;
  /** The asking PC is done or cancels (`declined` false), or the answering PC's user said no. */
  end(id: string, declined: boolean): Promise<void>;
}

export interface PairingOptions {
  /** The cloud copy: its account key is what is sent and received, and its folder (when it has one) is a way to ask. */
  copySync: Pick<CopySync, "accountKey" | "place" | "keyArrived" | "shareableKey">;
  /** The account: signed in, the messages go through Tavora's service. */
  account: { token(): string | null };
  /** The account service, ending in /v1/account. */
  serviceUrl: string;
  fetch?: typeof fetch;
  /** This PC's name, which a request in the copy's folder goes by. */
  deviceName: string;
  /** The key came and was kept: whatever depends on the account's key (the publisher keys) looks again. */
  keyKept?: () => Promise<void>;
  /** The messages in the copy's folder; the folder's files unless a test says otherwise. */
  folderTransport?: (folder: string, deviceName: string) => PairingTransport;
  onChange: (view: PairingView) => void;
  /** Brings Tavora to the front: another PC asks. */
  focus: () => void;
  /** Where the open answers are kept, so a restart doesn't reset the count; in memory only without it. */
  answersFile?: string;
  now?: () => number;
  log?: (line: string) => void;
}

interface Asking {
  transport: PairingTransport;
  id: string;
  key: PairingKey;
  expiresAt: number;
  /** When this PC asked, and whether it has said yet that no answer came for a while. */
  askedAt: number;
  slow: boolean;
  step: NonNullable<PairingView["asking"]>["step"];
  oldKey: Buffer | null;
  code: string | null;
  from: string | null;
  /** The sealed key, when it came before this PC's user said the codes match; opened only after that. */
  sealed: Buffer | null;
}

interface Answering {
  transport: PairingTransport;
  id: string;
  key: PairingKey;
  name: string | null;
  /** The new PC's promise as it was when this PC answered: its key has to be the one in it. */
  commit: Buffer;
  /** When this PC answered: without the new PC's key for ANSWER_WAIT_MS, it lets go. */
  at: number;
  reveal: Buffer | null;
  code: string | null;
}

/** An answer that may not end with Add: the request it went to (`via:id`; none for one kept from before a restart), and when. */
interface OpenAnswer {
  request: string | null;
  at: number;
}

/** A promise is a sha256 hash. */
const COMMIT_BYTES = 32;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const unb64 = (text: string) => Buffer.from(text, "base64url");

export class Pairing {
  private asking: Asking | null = null;
  private answering: Answering | null = null;
  /** Requests this PC's user turned down or that didn't check out: not answered again. */
  private refused = new Set<string>();
  /** When this PC answered each request that didn't (or may not) end with Add; see MAX_OPEN_ANSWERS. */
  private openAnswers: OpenAnswer[] | null = null;
  /** How often this PC said it answers no more for now (the page shows a notice for each), and when it last did. */
  private tooManyTries = 0;
  private tooManyAt = -Infinity;
  /** The last save of the open answers, which the next one waits for. */
  private saving: Promise<void> = Promise.resolve();
  private askTimer: ReturnType<typeof setTimeout> | undefined;
  private watchTimer: ReturnType<typeof setInterval> | undefined;
  private followTimer: ReturnType<typeof setTimeout> | undefined;
  private looking = false;
  private askLooking = false;

  private readonly servicePairing: ServicePairing;
  /** One per folder, so it remembers what it asked and answered. */
  private folderPairing: PairingTransport | null = null;
  private folderOf: string | null = null;

  constructor(private readonly options: PairingOptions) {
    this.servicePairing = new ServicePairing({ baseUrl: options.serviceUrl, fetch: options.fetch ?? ((input, init) => fetch(input, init)), token: () => options.account.token() });
  }

  private get accountKey(): AccountKey {
    return this.options.copySync.accountKey;
  }

  /**
   * This PC has the account's key: one that opens the account's vault as this PC last saw it. A key kept after another
   * PC started over (its vault no longer opens) is not: this PC may ask for the new one, and never hands out its own.
   */
  private get hasKey(): boolean {
    return this.key() !== null && this.accountKey.trouble !== "unopened";
  }

  /** The key this PC hands out: the account's signed in; signed out, the cloud copy's while it is on in its folder. */
  private key(): Buffer | null {
    return this.options.copySync.shareableKey();
  }

  /** Tavora's service, while signed in. */
  private service(): PairingTransport | null {
    return this.options.account.token() ? this.servicePairing : null;
  }

  /** The cloud copy's folder, while the copy is kept in one. */
  private folder(): PairingTransport | null {
    const place = this.options.copySync.place;
    if (!place) return null;
    if (this.folderOf !== place || !this.folderPairing) {
      this.folderOf = place;
      this.folderPairing = (this.options.folderTransport ?? ((folder, name) => new FolderPairing(folder, name)))(place, this.options.deviceName);
    }
    return this.folderPairing;
  }

  /** The key another PC sent: checked like a typed one, then the copy and whatever depends on the key go on with it. */
  private async received(key: Buffer, via: PairingTransport["via"]): Promise<void> {
    if (via === "service") await this.accountKey.take(key);
    else await this.accountKey.takeHere(key);
    await this.options.copySync.keyArrived();
    await this.options.keyKept?.();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  view(): PairingView {
    const asking = this.asking;
    const answering = this.answering;
    return {
      asking: asking ? { via: asking.transport.via, step: asking.step, code: asking.code, from: asking.from, slow: asking.step === "waiting" && asking.slow } : null,
      approve: answering?.code ? { id: answering.id, name: answering.name, code: answering.code } : null,
      tooManyTries: this.tooManyTries,
    };
  }

  private changed(): void {
    this.options.onChange(this.view());
  }

  // ── The new PC ─────────────────────────────────────────────────────

  /** Asks the account's other PCs for the key: through the service when signed in, else the copy's folder. */
  async start(): Promise<void> {
    await this.cancel();
    const transport = this.service() ?? this.folder();
    if (!transport) throw new UserError("pairing.error.nowhere");
    const key = newPairingKey();
    let asked: { id: string; expiresAt: number };
    try {
      asked = await transport.ask(b64(pairingCommit(key.publicKey)));
    } catch (error) {
      throw toUserError(error);
    }
    this.asking = { transport, id: asked.id, key, expiresAt: asked.expiresAt, askedAt: this.now(), slow: false, step: "waiting", oldKey: null, code: null, from: null, sealed: null };
    this.changed();
    this.askSoon();
  }

  /** The new PC gives up, or the user closes what went wrong. */
  async cancel(): Promise<void> {
    const asking = this.asking;
    if (!asking) return;
    this.asking = null;
    clearTimeout(this.askTimer);
    this.changed();
    if (asking.step === "waiting" || asking.step === "code" || asking.step === "confirmed") await asking.transport.end(asking.id, false).catch(() => undefined);
  }

  /**
   * This PC's user says the other PC shows the same code. Only then is a key from it used: the code covers
   * both one-time keys, so a key sealed by anyone else can't be opened with the one that was checked.
   */
  async confirm(): Promise<void> {
    const asking = this.asking;
    if (!asking || asking.step !== "code" || !asking.oldKey) throw new UserError("pairing.error.gone");
    // The recovery key was typed in meanwhile.
    if (this.hasKey) return this.cancel();
    asking.step = "confirmed";
    if (asking.sealed) return this.finish(asking, asking.sealed);
    // Not sent yet: the old PC's user still has to click Add.
    this.changed();
    await this.lookForAnswer();
  }

  private askSoon(): void {
    clearTimeout(this.askTimer);
    const asking = this.asking;
    if (!asking || (asking.step !== "waiting" && asking.step !== "code" && asking.step !== "confirmed")) return;
    this.askTimer = setTimeout(() => void this.lookForAnswer(), ASK_EVERY_MS[asking.transport.via]);
    this.askTimer.unref?.();
  }

  /** One look at the request this PC asked; none while one is under way (the service hands the key over only once). Public for tests. */
  async lookForAnswer(): Promise<void> {
    if (this.askLooking) return;
    this.askLooking = true;
    try {
      await this.lookOnce();
    } finally {
      this.askLooking = false;
    }
  }

  private async lookOnce(): Promise<void> {
    const asking = this.asking;
    if (!asking) return;
    // The recovery key was typed in meanwhile.
    if (this.hasKey) return this.cancel();
    // No answer for a while: the page says to check the other PC (it may answer no more for now).
    if (asking.step === "waiting" && !asking.slow && this.now() - asking.askedAt >= SLOW_ANSWER_MS[asking.transport.via]) {
      asking.slow = true;
      this.changed();
    }
    // A key that came before the codes were checked waits here, unread again (the service hands it over only
    // once), until the press, the recovery key typed in, or the request running out.
    if (asking.sealed) {
      if (this.now() < asking.expiresAt) return this.askSoon();
      await asking.transport.end(asking.id, false).catch(() => undefined);
      return this.stop(asking, "expired");
    }
    let request: PairingRequest | null;
    try {
      request = await asking.transport.read();
    } catch (error) {
      if (error instanceof CopyError && (error.reason === "signed-out" || error.reason === "no-folder" || error.reason === "folder-locked")) return this.stop(asking, "failed");
      // Offline for a moment, or a file a sync app is still bringing: looked at again soon.
      this.askSoon();
      return;
    }
    if (this.asking !== asking) return;
    if (!request || request.id !== asking.id || !request.own) return this.stop(asking, this.now() >= asking.expiresAt ? "expired" : "gone");
    if (request.declined) return this.stop(asking, "declined");
    if (this.now() >= asking.expiresAt) {
      await asking.transport.end(asking.id, false).catch(() => undefined);
      return this.stop(asking, "expired");
    }
    try {
      if (request.answer && !asking.oldKey) {
        asking.oldKey = unb64(request.answer.publicKey);
        await asking.transport.reveal(asking.id, b64(asking.key.publicKey));
        asking.code = pairingCode(asking.key.publicKey, asking.oldKey);
        asking.from = request.answer.name;
        asking.step = "code";
        this.changed();
      }
      if (request.sealed && asking.oldKey) {
        const sealed = unb64(request.sealed);
        if (asking.step === "confirmed") return this.finish(asking, sealed);
        // Kept unopened until this PC's user says the codes match (confirm).
        asking.sealed = sealed;
        return this.askSoon();
      }
    } catch (error) {
      return this.fail(asking, error);
    }
    this.askSoon();
  }

  /** The codes match and the key came: it is opened with the checked one-time key, then kept. */
  private async finish(asking: Asking, sealed: Buffer): Promise<void> {
    clearTimeout(this.askTimer);
    try {
      const root = openFromPc(asking.key, asking.oldKey!, sealed);
      await asking.transport.end(asking.id, false).catch(() => undefined);
      await this.received(root, asking.transport.via);
    } catch (error) {
      return this.fail(asking, error);
    }
    if (this.asking === asking) this.asking = null;
    this.changed();
  }

  private async fail(asking: Asking, error: unknown): Promise<void> {
    this.options.log?.(`pairing: ${error instanceof Error ? error.message : String(error)}`);
    await asking.transport.end(asking.id, false).catch(() => undefined);
    return this.stop(asking, "failed");
  }

  private stop(asking: Asking, step: "expired" | "gone" | "declined" | "failed"): void {
    if (this.asking !== asking) return;
    clearTimeout(this.askTimer);
    asking.step = step === "gone" ? "expired" : step;
    this.changed();
  }

  // ── The old PCs ────────────────────────────────────────────────────

  /** Looks for PCs that ask every few seconds, while this PC has the account's key. */
  watch(): void {
    clearInterval(this.watchTimer);
    this.watchTimer = setInterval(() => void this.lookForRequests(), WATCH_EVERY_MS);
    this.watchTimer.unref?.();
    void this.lookForRequests();
  }

  dispose(): void {
    clearInterval(this.watchTimer);
    clearTimeout(this.askTimer);
    clearTimeout(this.followTimer);
  }

  /** One look for a PC that asks. Public for tests. */
  async lookForRequests(): Promise<void> {
    if (this.looking || this.asking || !this.hasKey) return;
    this.looking = true;
    try {
      // Answered, and the new PC's key never came (or the request can't be read): let go, and look everywhere again.
      const stale = this.answering;
      if (stale && !stale.reveal && this.now() - stale.at >= ANSWER_WAIT_MS[stale.transport.via]) {
        this.refused.add(stale.id);
        this.answering = null;
        this.changed();
        await stale.transport.end(stale.id, false).catch(() => undefined);
      }
      // While answering one request, only its way is looked at.
      const ways = this.answering ? [this.answering.transport] : [this.service(), this.folder()];
      for (const transport of ways) {
        if (transport) await this.lookAt(transport);
        if (this.answering) break;
      }
    } finally {
      this.looking = false;
    }
    // Answered: the other PC shows its key within seconds, so the code comes up without the long wait.
    clearTimeout(this.followTimer);
    if (this.answering && !this.answering.reveal) {
      this.followTimer = setTimeout(() => void this.lookForRequests(), ASK_EVERY_MS[this.answering.transport.via]);
      this.followTimer.unref?.();
    }
  }

  private async lookAt(transport: PairingTransport): Promise<void> {
    let request: PairingRequest | null;
    try {
      request = await transport.read(this.refused);
    } catch {
      return;
    }
    const answering = this.answering;
    if (answering && answering.transport.via === transport.via && (!request || request.id !== answering.id || request.declined || this.now() >= request.expiresAt)) {
      // Done, given up, run out or answered by another PC: not answered again.
      this.refused.add(answering.id);
      this.answering = null;
      this.changed();
      return;
    }
    if (!request || request.own || request.declined || this.refused.has(request.id) || this.now() >= request.expiresAt) return;
    try {
      if (!answering) {
        if (request.answer) return;
        const commit = unb64(request.commit);
        if (commit.length !== COMMIT_BYTES) return;
        const open = await this.loadOpenAnswers();
        if (open.filter((answer) => this.now() - answer.at < OPEN_ANSWER_MS).length >= MAX_OPEN_ANSWERS) return this.tooMany();
        const key = newPairingKey();
        // Counted before the key goes out: whatever comes back (another PC was first, an error), the other side has
        // seen it, and the request isn't answered again.
        // Not saved, a restart would forget it: then the key doesn't go out.
        if (!(await this.countAnswer(transport, request.id))) return;
        let answered = false;
        try {
          answered = await transport.answer(request.id, b64(key.publicKey));
        } finally {
          if (!answered) this.refused.add(request.id);
        }
        if (answered) this.answering = { transport, id: request.id, key, name: request.name, commit, at: this.now(), reveal: null, code: null };
        return;
      }
      if (answering.id !== request.id) return;
      // What this PC answered to changed on the way: the promise, its own key, or a key already checked. Something
      // missing (a file a sync app hasn't finished) is looked at again.
      const changed = (seen: string | undefined, kept: Buffer) => seen !== undefined && seen !== "" && !unb64(seen).equals(kept);
      if (changed(request.commit, answering.commit) || changed(request.answer?.publicKey, answering.key.publicKey) || (answering.reveal && changed(request.reveal, answering.reveal))) {
        return this.refuse(answering, "pairing: a PC's request changed after this PC answered it");
      }
      if (!request.commit || !request.answer || answering.reveal || !request.reveal) return;
      const reveal = unb64(request.reveal);
      if (!timingSafeEqual(pairingCommit(reveal), answering.commit)) {
        // Its key isn't the one it promised: something on the way is off.
        return this.refuse(answering, "pairing: a PC's key did not match what it promised");
      }
      answering.reveal = reveal;
      answering.code = pairingCode(reveal, answering.key.publicKey);
      this.changed();
      this.options.focus();
    } catch (error) {
      this.options.log?.(`pairing: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async loadOpenAnswers(): Promise<OpenAnswer[]> {
    if (this.openAnswers) return this.openAnswers;
    const open: OpenAnswer[] = [];
    const file = this.options.answersFile;
    if (file) {
      try {
        const saved = JSON.parse(await readFile(file, "utf8")) as { at?: unknown };
        // A time ahead of now (the clock was ahead) counts from now, so it can't hold answering up for longer.
        if (Array.isArray(saved.at)) for (const at of saved.at) if (typeof at === "number" && Number.isFinite(at)) open.push({ request: null, at: Math.min(at, this.now()) });
      } catch {
        // None yet, or unreadable: none counted.
      }
    }
    // Another look may have loaded them meanwhile.
    return (this.openAnswers ??= open);
  }

  /** One more answer that may not end with Add; a request counts once. False when it couldn't be saved. */
  private async countAnswer(transport: PairingTransport, id: string): Promise<boolean> {
    const open = await this.loadOpenAnswers();
    const request = `${transport.via}:${id}`;
    const now = this.now();
    this.openAnswers = [...open.filter((answer) => now - answer.at < OPEN_ANSWER_MS && answer.request !== request), { request, at: now }];
    return this.saveOpenAnswers();
  }

  /** The user clicked Add and the key went out: that answer no longer counts. */
  private async uncountAnswer(transport: PairingTransport, id: string): Promise<void> {
    const request = `${transport.via}:${id}`;
    const open = await this.loadOpenAnswers();
    if (!open.some((answer) => answer.request === request)) return;
    this.openAnswers = open.filter((answer) => answer.request !== request);
    await this.saveOpenAnswers();
  }

  /**
   * Writes the answers as they are when its turn comes, one save after another, so an older list never lands last.
   * False when it couldn't be written.
   */
  private saveOpenAnswers(): Promise<boolean> {
    const file = this.options.answersFile;
    if (!file) return Promise.resolve(true);
    const saved = this.saving.then(async () => {
      try {
        await writeFileAtomic(file, JSON.stringify({ v: 1, at: (this.openAnswers ?? []).map((answer) => answer.at) }));
        return true;
      } catch (error) {
        this.options.log?.(`pairing: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    });
    this.saving = saved.then(() => undefined);
    return saved;
  }

  /** A PC asks while this one answers no more for now: the page says so, now and then. */
  private tooMany(): void {
    if (this.now() - this.tooManyAt < TOO_MANY_NOTICE_MS) return;
    this.tooManyAt = this.now();
    this.tooManyTries++;
    this.options.log?.("pairing: too many answers without a click, answering none for now");
    this.changed();
  }

  /** Something on the way is off: the request is turned down and not answered again. */
  private async refuse(answering: Answering, why: string): Promise<void> {
    this.options.log?.(why);
    this.refused.add(answering.id);
    if (this.answering === answering) this.answering = null;
    this.changed();
    await answering.transport.end(answering.id, true).catch(() => undefined);
  }

  /** The user's click on "Add <PC>?": the key goes to it sealed, or the request is turned down. */
  async decide(id: string, allow: boolean): Promise<void> {
    const answering = this.answering;
    if (!answering || answering.id !== id || !answering.reveal) throw new UserError("pairing.error.gone");
    this.answering = null;
    this.refused.add(id);
    this.changed();
    const key = this.hasKey ? this.key() : null;
    try {
      // Signed in, the key goes out only when it still opens the account's vault (another PC may have started over since).
      if (allow && key && this.accountKey.signedIn && !(await this.accountKey.fits())) {
        await answering.transport.end(id, true).catch(() => undefined);
        this.changed();
        throw new UserError("pairing.error.oldKey");
      }
      if (allow && key) await answering.transport.sendKey(id, b64(sealForPc(answering.key, answering.reveal, key)));
      else await answering.transport.end(id, true);
    } catch (error) {
      // Add did not get there (offline): the question shows again, so the user can try again before it expires. A No
      // that did not get there stays a no: the request is left to expire.
      if (allow && !this.answering) {
        this.answering = answering;
        this.refused.delete(id);
        this.changed();
      }
      throw toUserError(error);
    }
    if (allow && !key) throw new UserError("pairing.error.gone");
    // Only an Add takes an answer off the count: after a No it stays, or every wrong code shown would be a free try.
    if (allow) await this.uncountAnswer(answering.transport, id);
  }
}

function toUserError(error: unknown): UserError {
  if (error instanceof UserError) return error;
  const reason = error instanceof CopyError ? error.reason : "failed";
  if (reason === "unreachable" || reason === "unavailable" || reason === "too-many") return new UserError("cloudCopy.error.offline");
  if (reason === "signed-out") return new UserError("cloudCopy.error.signed-out");
  if (reason === "no-folder") return new UserError("cloudCopy.error.no-folder");
  if (reason === "folder-locked") return new UserError("cloudCopy.error.folder-locked");
  return new UserError("pairing.error.gone");
}

// ── Through Tavora's service ─────────────────────────────────────────

export interface ServicePairingOptions {
  /** The account service, ending in /v1/account. */
  baseUrl: string;
  fetch: typeof fetch;
  token: () => string | null;
  timeoutMs?: number;
}

export class ServicePairing implements PairingTransport {
  readonly via = "service";

  constructor(private readonly options: ServicePairingOptions) {}

  private async request(method: string, route: string, body?: unknown): Promise<Response> {
    const token = this.options.token();
    if (!token) throw new CopyError("signed-out");
    let response: Response;
    try {
      response = await this.options.fetch(`${this.options.baseUrl}/pairing${route}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      });
    } catch {
      throw new CopyError("unreachable");
    }
    if (response.status === 401) throw new CopyError("signed-out");
    if (response.status === 429) throw new CopyError("too-many");
    if (response.status === 503) throw new CopyError("unavailable");
    return response;
  }

  private async step(route: string, body: unknown): Promise<Response> {
    const response = await this.request("POST", route, body);
    if (response.status === 404) throw new UserError("pairing.error.gone");
    if (!response.ok && response.status !== 409) throw new CopyError("failed", `pairing answered ${response.status}`);
    return response;
  }

  async read(): Promise<PairingRequest | null> {
    const response = await this.request("GET", "");
    if (response.status === 204) return null;
    if (!response.ok) throw new CopyError("failed", `pairing answered ${response.status}`);
    const raw = (await response.json()) as Record<string, unknown>;
    if (typeof raw.id !== "string") throw new CopyError("failed", "pairing's answer was off");
    if (raw.declined === true) return { id: raw.id, own: raw.own === true, name: null, commit: "", expiresAt: 0, declined: true };
    if (typeof raw.commit !== "string" || typeof raw.expiresAt !== "string") throw new CopyError("failed", "pairing's answer was off");
    const answer = raw.answer as { name?: unknown; publicKey?: unknown } | undefined;
    return {
      id: raw.id,
      own: raw.own === true,
      name: typeof raw.name === "string" ? raw.name : null,
      commit: raw.commit,
      expiresAt: Date.parse(raw.expiresAt),
      ...(answer && typeof answer.publicKey === "string" ? { answer: { name: typeof answer.name === "string" ? answer.name : null, publicKey: answer.publicKey } } : {}),
      ...(typeof raw.reveal === "string" ? { reveal: raw.reveal } : {}),
      ...(typeof raw.sealed === "string" ? { sealed: raw.sealed } : {}),
    };
  }

  async ask(commit: string): Promise<{ id: string; expiresAt: number }> {
    const response = await this.request("POST", "", { commit });
    if (!response.ok) throw new CopyError("failed", `pairing answered ${response.status}`);
    const raw = (await response.json()) as { id?: unknown; expiresAt?: unknown };
    if (typeof raw.id !== "string" || typeof raw.expiresAt !== "string") throw new CopyError("failed", "pairing's answer was off");
    return { id: raw.id, expiresAt: Date.parse(raw.expiresAt) };
  }

  async answer(id: string, publicKey: string): Promise<boolean> {
    return (await this.step(`/${encodeURIComponent(id)}/answer`, { publicKey })).ok;
  }

  async reveal(id: string, publicKey: string): Promise<void> {
    await this.step(`/${encodeURIComponent(id)}/reveal`, { publicKey });
  }

  async sendKey(id: string, sealed: string): Promise<void> {
    const response = await this.step(`/${encodeURIComponent(id)}/key`, { sealed });
    if (!response.ok) throw new UserError("pairing.error.gone");
  }

  async end(id: string): Promise<void> {
    await this.request("DELETE", `/${encodeURIComponent(id)}`);
  }
}

// ── Through the cloud copy's folder ──────────────────────────────────

/**
 * The same steps as files in <folder>/Tavora/pairing/, one file per step, named by the request's id.
 * Only those exact names are read, so a sync app's "… (1).json" copies are left alone. The PC that asks
 * deletes them when it is done; any PC deletes ones whose request ran out.
 */
const STEP_FILE = /^([0-9a-f]{16})\.(request|answer|reveal|key|declined)\.json$/;
type Step = "request" | "answer" | "reveal" | "key" | "declined";

export class FolderPairing implements PairingTransport {
  readonly via = "folder";
  private readonly dir: string;
  /** The request this PC asked. */
  private ownId: string | null = null;
  /** This PC's answers, so it knows which answer file is its own. */
  private answered = new Map<string, string>();

  constructor(
    readonly folder: string,
    /** This PC's name, shown on the other one. */
    private readonly name: string,
    private readonly now: () => number = Date.now,
  ) {
    this.dir = path.join(folder, FOLDER_NAME, "pairing");
  }

  private file(id: string, step: Step) {
    return path.join(this.dir, `${id}.${step}.json`);
  }

  /** A step's file as it is, not what a link in its place leads to: null when it is a link or anything else than a file. */
  private async ownFile(id: string, step: Step) {
    const info = await lstat(this.file(id, step)).catch(() => null);
    return info?.isFile() ? info : null;
  }

  private async readStep(id: string, step: Step): Promise<Record<string, unknown> | null> {
    try {
      // A link in a step's place leads out of the folder: not read, as if a sync app hadn't finished it.
      if (!(await this.ownFile(id, step))) return null;
      const value = JSON.parse(await readFile(this.file(id, step), "utf8")) as unknown;
      return typeof value === "object" && value !== null && !Array.isArray(value) && (value as { v?: unknown }).v === 1 ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  /**
   * The pairing folder and the "Tavora" one it is in, when neither is a link or junction: one would lead out of the
   * folder, and nothing there is read, written or cleaned up ("other"). lstat, as in copy-folder.ts.
   */
  private async kind(): Promise<"dir" | "missing" | "other"> {
    for (const dir of [path.dirname(this.dir), this.dir]) {
      const info = await lstat(dir).catch(() => null);
      if (!info) return "missing";
      if (info.isSymbolicLink() || !info.isDirectory()) return "other";
    }
    return "dir";
  }

  private async write(id: string, step: Step, value: Record<string, unknown>): Promise<void> {
    if (!(await stat(path.dirname(this.dir)).catch(() => null))?.isDirectory()) throw new CopyError("no-folder", "the cloud copy folder is not there");
    if ((await this.kind()) === "other") throw new CopyError("folder-locked", "the cloud copy folder holds a link where Tavora keeps its files");
    await writeFileAtomic(this.file(id, step), JSON.stringify({ v: 1, ...value }));
  }

  private async remove(id: string): Promise<void> {
    for (const step of ["request", "answer", "reveal", "key", "declined"] as const) await rm(this.file(id, step), { force: true });
  }

  async read(skip: ReadonlySet<string> = new Set()): Promise<PairingRequest | null> {
    const names = (await this.kind()) === "dir" ? await readdir(this.dir).catch(() => [] as string[]) : [];
    const steps = new Map<string, Set<Step>>();
    for (const name of names) {
      const match = STEP_FILE.exec(name);
      if (!match) continue;
      const set = steps.get(match[1]!) ?? new Set<Step>();
      set.add(match[2] as Step);
      steps.set(match[1]!, set);
    }
    // A request this PC answered whose files are all gone is done with.
    for (const id of this.answered.keys()) if (!steps.has(id)) this.answered.delete(id);
    let found: PairingRequest | null = null;
    for (const [id, have] of steps) {
      const own = id === this.ownId;
      if (!have.has("request")) {
        // Its request is gone: done with it here too, and what's left is cleaned up once it is old.
        this.answered.delete(id);
        if (!own) await this.removeIfOld(id);
        continue;
      }
      const request = await this.readStep(id, "request");
      if (!request || typeof request.commit !== "string" || typeof request.expiresAt !== "number") {
        // Not readable (yet): a sync app may still be bringing it, or have it locked. Cleaned up only once it is older
        // than any request lasts; until then, a request this PC asked or answered is looked at again next time.
        if (await this.isOld(id, "request")) await this.remove(id);
        else if (own || this.answered.has(id)) throw new Error("a pairing file isn't readable yet");
        continue;
      }
      const expiresAt = request.expiresAt;
      // Run out, or lasting longer than any request Tavora makes: one planted there would never go.
      if (expiresAt <= this.now() || expiresAt > this.now() + FOLDER_PAIRING_MS + CLOCK_AHEAD_MS) {
        await this.remove(id);
        continue;
      }
      if (have.has("declined")) {
        if (own) return { id, own, name: null, commit: "", expiresAt, declined: true };
        continue;
      }
      const answer = have.has("answer") ? await this.readStep(id, "answer") : null;
      const mine = answer && answer.by === this.answered.get(id);
      // Answered by another PC: not for this one. An answer that isn't readable yet is someone's too, unless this PC
      // answered: then the request comes without it, and is looked at again.
      if (!own && answer && !mine) this.answered.delete(id);
      if (!own && have.has("answer") && !mine && (answer || !this.answered.has(id))) continue;
      const reveal = have.has("reveal") ? await this.readStep(id, "reveal") : null;
      const key = own && have.has("key") ? await this.readStep(id, "key") : null;
      const seen: PairingRequest = {
        id,
        own,
        name: typeof request.name === "string" ? request.name : null,
        commit: request.commit,
        expiresAt,
        ...(answer && typeof answer.publicKey === "string" ? { answer: { name: typeof answer.name === "string" ? answer.name : null, publicKey: answer.publicKey } } : {}),
        ...(typeof reveal?.publicKey === "string" ? { reveal: reveal.publicKey } : {}),
        ...(typeof key?.sealed === "string" ? { sealed: key.sealed } : {}),
      };
      if (own) return seen;
      // Of several, the newest one this PC hasn't let go of; the one it answers comes first.
      if (skip.has(id) && !this.answered.has(id)) continue;
      if (this.answered.has(id)) found = seen;
      else if (!found || (!this.answered.has(found.id) && seen.expiresAt > found.expiresAt)) found = seen;
    }
    return found;
  }

  private async removeIfOld(id: string): Promise<void> {
    for (const step of ["answer", "reveal", "key", "declined"] as const) if (await this.isOld(id, step)) await rm(this.file(id, step), { force: true });
  }

  /** Written longer ago than any request lasts. */
  private async isOld(id: string, step: Step): Promise<boolean> {
    const info = await lstat(this.file(id, step)).catch(() => null);
    return info !== null && this.now() - info.mtimeMs > FOLDER_PAIRING_MS;
  }

  async ask(commit: string): Promise<{ id: string; expiresAt: number }> {
    if (this.ownId) await this.remove(this.ownId);
    const id = randomBytes(8).toString("hex");
    const expiresAt = this.now() + FOLDER_PAIRING_MS;
    await this.write(id, "request", { name: this.name, commit, expiresAt });
    this.ownId = id;
    return { id, expiresAt };
  }

  async answer(id: string, publicKey: string): Promise<boolean> {
    // Any answer there, readable yet or not, is another PC's.
    if (await lstat(this.file(id, "answer")).catch(() => null)) return false;
    const by = randomBytes(8).toString("hex");
    // One request at a time: the one answered before is done with.
    this.answered.clear();
    this.answered.set(id, by);
    await this.write(id, "answer", { by, name: this.name, publicKey });
    return true;
  }

  async reveal(id: string, publicKey: string): Promise<void> {
    await this.write(id, "reveal", { publicKey });
  }

  async sendKey(id: string, sealed: string): Promise<void> {
    await this.write(id, "key", { sealed });
    this.answered.delete(id);
  }

  async end(id: string, declined: boolean): Promise<void> {
    if (id === this.ownId) {
      this.ownId = null;
      await this.remove(id);
      return;
    }
    this.answered.delete(id);
    if (declined) await this.write(id, "declined", {});
  }
}
