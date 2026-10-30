import { randomBytes, timingSafeEqual } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
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

/** How long a request through the folder lasts: a sync app can be slow. */
export const FOLDER_PAIRING_MS = 24 * 60 * 60_000;
/** How often a PC that asks looks for an answer. */
const ASK_EVERY_MS = { service: 3_000, folder: 5_000 };
/** How often a PC with the key looks for a PC that asks. */
const WATCH_EVERY_MS = 15_000;

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
  /** The request this PC asked, or one it may answer (or answered); null when there is none. */
  read(): Promise<PairingRequest | null>;
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
  copySync: Pick<CopySync, "accountKey" | "place" | "keyArrived">;
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
  now?: () => number;
  log?: (line: string) => void;
}

interface Asking {
  transport: PairingTransport;
  id: string;
  key: PairingKey;
  expiresAt: number;
  step: NonNullable<PairingView["asking"]>["step"];
  oldKey: Buffer | null;
  code: string | null;
  from: string | null;
}

interface Answering {
  transport: PairingTransport;
  id: string;
  key: PairingKey;
  name: string | null;
  reveal: Buffer | null;
  code: string | null;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const unb64 = (text: string) => Buffer.from(text, "base64url");

export class Pairing {
  private asking: Asking | null = null;
  private answering: Answering | null = null;
  /** Requests this PC's user turned down or that didn't check out: not answered again. */
  private refused = new Set<string>();
  private askTimer: ReturnType<typeof setTimeout> | undefined;
  private watchTimer: ReturnType<typeof setInterval> | undefined;
  private followTimer: ReturnType<typeof setTimeout> | undefined;
  private looking = false;

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
      asking: asking ? { via: asking.transport.via, step: asking.step, code: asking.code, from: asking.from } : null,
      approve: answering?.code ? { id: answering.id, name: answering.name, code: answering.code } : null,
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
    this.asking = { transport, id: asked.id, key, expiresAt: asked.expiresAt, step: "waiting", oldKey: null, code: null, from: null };
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
    if (asking.step === "waiting" || asking.step === "code") await asking.transport.end(asking.id, false).catch(() => undefined);
  }

  private askSoon(): void {
    clearTimeout(this.askTimer);
    const asking = this.asking;
    if (!asking || (asking.step !== "waiting" && asking.step !== "code")) return;
    this.askTimer = setTimeout(() => void this.lookForAnswer(), ASK_EVERY_MS[asking.transport.via]);
    this.askTimer.unref?.();
  }

  /** One look at the request this PC asked. Public for tests. */
  async lookForAnswer(): Promise<void> {
    const asking = this.asking;
    if (!asking) return;
    // The recovery key was typed in meanwhile.
    if (this.accountKey.get()) return this.cancel();
    let request: PairingRequest | null;
    try {
      request = await asking.transport.read();
    } catch (error) {
      if (error instanceof CopyError && (error.reason === "signed-out" || error.reason === "no-folder" || error.reason === "folder-locked")) return this.stop(asking, "failed");
      // Offline for a moment: looked at again soon.
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
        const root = openFromPc(asking.key, asking.oldKey, unb64(request.sealed));
        await asking.transport.end(asking.id, false).catch(() => undefined);
        await this.received(root, asking.transport.via);
        if (this.asking === asking) this.asking = null;
        clearTimeout(this.askTimer);
        this.changed();
        return;
      }
    } catch (error) {
      this.options.log?.(`pairing: ${error instanceof Error ? error.message : String(error)}`);
      await asking.transport.end(asking.id, false).catch(() => undefined);
      return this.stop(asking, "failed");
    }
    this.askSoon();
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
    if (this.looking || this.asking || !this.accountKey.get()) return;
    this.looking = true;
    try {
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
      request = await transport.read();
    } catch {
      return;
    }
    const answering = this.answering;
    if (answering && answering.transport.via === transport.via && (!request || request.id !== answering.id || request.declined)) {
      // Done, given up or answered by another PC.
      this.answering = null;
      this.changed();
      return;
    }
    if (!request || request.own || request.declined || this.refused.has(request.id) || this.now() >= request.expiresAt) return;
    try {
      if (!answering) {
        if (request.answer) return;
        const key = newPairingKey();
        if (!(await transport.answer(request.id, b64(key.publicKey)))) return;
        this.answering = { transport, id: request.id, key, name: request.name, reveal: null, code: null };
        return;
      }
      if (answering.id !== request.id || answering.reveal || !request.reveal) return;
      const reveal = unb64(request.reveal);
      const commit = unb64(request.commit);
      const expected = pairingCommit(reveal);
      if (commit.length !== expected.length || !timingSafeEqual(commit, expected)) {
        // Its key isn't the one it promised: something on the way is off.
        this.options.log?.("pairing: a PC's key did not match what it promised");
        this.refused.add(request.id);
        this.answering = null;
        await transport.end(request.id, true).catch(() => undefined);
        return;
      }
      answering.reveal = reveal;
      answering.code = pairingCode(reveal, answering.key.publicKey);
      this.changed();
      this.options.focus();
    } catch (error) {
      this.options.log?.(`pairing: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The user's click on "Add <PC>?": the key goes to it sealed, or the request is turned down. */
  async decide(id: string, allow: boolean): Promise<void> {
    const answering = this.answering;
    if (!answering || answering.id !== id || !answering.reveal) throw new UserError("pairing.error.gone");
    this.answering = null;
    this.refused.add(id);
    this.changed();
    const key = this.accountKey.get();
    try {
      if (allow && key) await answering.transport.sendKey(id, b64(sealForPc(answering.key, answering.reveal, key)));
      else await answering.transport.end(id, true);
    } catch (error) {
      throw toUserError(error);
    }
    if (allow && !key) throw new UserError("pairing.error.gone");
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

  private async readStep(id: string, step: Step): Promise<Record<string, unknown> | null> {
    try {
      const value = JSON.parse(await readFile(this.file(id, step), "utf8")) as unknown;
      return typeof value === "object" && value !== null && !Array.isArray(value) && (value as { v?: unknown }).v === 1 ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  private async write(id: string, step: Step, value: Record<string, unknown>): Promise<void> {
    if (!(await stat(path.dirname(this.dir)).catch(() => null))?.isDirectory()) throw new CopyError("no-folder", "the cloud copy folder is not there");
    await writeFileAtomic(this.file(id, step), JSON.stringify({ v: 1, ...value }));
  }

  private async remove(id: string): Promise<void> {
    for (const step of ["request", "answer", "reveal", "key", "declined"] as const) await rm(this.file(id, step), { force: true });
  }

  async read(): Promise<PairingRequest | null> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const steps = new Map<string, Set<Step>>();
    for (const name of names) {
      const match = STEP_FILE.exec(name);
      if (!match) continue;
      const set = steps.get(match[1]!) ?? new Set<Step>();
      set.add(match[2] as Step);
      steps.set(match[1]!, set);
    }
    let found: PairingRequest | null = null;
    for (const [id, have] of steps) {
      const own = id === this.ownId;
      if (!have.has("request")) {
        // Its request is gone: what's left is cleaned up once it is old.
        if (!own) await this.removeIfOld(id);
        continue;
      }
      const request = await this.readStep(id, "request");
      const expiresAt = typeof request?.expiresAt === "number" ? request.expiresAt : 0;
      if (!request || typeof request.commit !== "string" || expiresAt <= this.now()) {
        if (request || !own) await this.remove(id);
        continue;
      }
      if (have.has("declined")) {
        if (own) return { id, own, name: null, commit: "", expiresAt, declined: true };
        continue;
      }
      const answer = have.has("answer") ? await this.readStep(id, "answer") : null;
      const mine = answer && answer.by === this.answered.get(id);
      // Answered by another PC: not for this one.
      if (!own && answer && !mine) continue;
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
      // Of several, the newest one.
      if (!found || seen.expiresAt > found.expiresAt) found = seen;
    }
    return found;
  }

  private async removeIfOld(id: string): Promise<void> {
    for (const step of ["answer", "reveal", "key", "declined"] as const) {
      const info = await stat(this.file(id, step)).catch(() => null);
      if (info && this.now() - info.mtimeMs > FOLDER_PAIRING_MS) await rm(this.file(id, step), { force: true });
    }
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
    if (await this.readStep(id, "answer")) return false;
    const by = randomBytes(8).toString("hex");
    this.answered.set(id, by);
    await this.write(id, "answer", { by, name: this.name, publicKey });
    return true;
  }

  async reveal(id: string, publicKey: string): Promise<void> {
    await this.write(id, "reveal", { publicKey });
  }

  async sendKey(id: string, sealed: string): Promise<void> {
    await this.write(id, "key", { sealed });
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
