import { writeFileAtomic } from "./fsutil";
import { readJsonOrSetAside } from "./json";

// The developer names players see for publisher keys ("by wellbrained" instead of a fingerprint).
// Tavora's service says which name a key's account chose; the answer is kept on this PC in
// publisher-names.json and asked again at most once a day, and only while the player allows the
// online features. A name is shown only in the plain form the service allows, so a name can never
// carry other text, links or direction marks.

/** How long a name (or "no name") is taken as current. */
export const NAME_FRESH_MS = 24 * 60 * 60_000;
/** Keys kept in the file; the oldest checks go first. */
const MAX_ENTRIES = 500;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{1,30}[A-Za-z0-9]$/;
/** A publisher key fingerprint, the owner id of a signed module. */
const FINGERPRINT = /^[0-9a-f]{32}$/;

interface Entry {
  name: string | null;
  checkedAt: number;
}

export interface PublisherNamesOptions {
  file: string;
  baseUrl: string;
  fetch: typeof fetch;
  /** Whether the player allows Tavora to ask its service (Settings > General > Online game search). */
  online: () => boolean;
  /** A name became known or changed. */
  onChange: () => void;
  now?: () => number;
  timeoutMs?: number;
}

function sanitize(raw: unknown): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  const record = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  for (const [fingerprint, value] of Object.entries(record)) {
    const entry = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
    if (!FINGERPRINT.test(fingerprint) || typeof entry.checkedAt !== "number" || !Number.isFinite(entry.checkedAt)) continue;
    entries.set(fingerprint, { name: typeof entry.name === "string" && NAME.test(entry.name) ? entry.name : null, checkedAt: entry.checkedAt });
  }
  return entries;
}

export class PublisherNames {
  private entries = new Map<string, Entry>();
  private readonly asking = new Set<string>();
  private readonly baseUrl: string;
  private readonly now: () => number;

  constructor(private readonly options: PublisherNamesOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.now = options.now ?? Date.now;
  }

  async load(): Promise<void> {
    this.entries = sanitize(await readJsonOrSetAside(this.options.file));
  }

  /** The developer name last known for a key, or null. */
  name(fingerprint: string): string | null {
    return this.entries.get(fingerprint)?.name ?? null;
  }

  /**
   * Asks the service about each key not checked in the last day, one after the other. Resolves once
   * every answer is in (or failed); a failure keeps what was known and is tried again next time.
   */
  async refresh(fingerprints: Iterable<string>): Promise<void> {
    if (!this.options.online()) return;
    let changed = false;
    for (const fingerprint of new Set(fingerprints)) {
      if (!FINGERPRINT.test(fingerprint) || this.asking.has(fingerprint)) continue;
      const known = this.entries.get(fingerprint);
      if (known && this.now() - known.checkedAt < NAME_FRESH_MS) continue;
      this.asking.add(fingerprint);
      try {
        const name = await this.ask(fingerprint);
        if (name === undefined) continue;
        if (known?.name !== name) changed = true;
        this.entries.set(fingerprint, { name, checkedAt: this.now() });
      } finally {
        this.asking.delete(fingerprint);
      }
    }
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = [...this.entries].sort((a, b) => a[1].checkedAt - b[1].checkedAt)[0]![0];
      this.entries.delete(oldest);
    }
    await writeFileAtomic(this.options.file, JSON.stringify(Object.fromEntries(this.entries))).catch(() => undefined);
    if (changed) this.options.onChange();
  }

  /** The name the service has for a key: a name, null for none, or undefined when it could not say. */
  private async ask(fingerprint: string): Promise<string | null | undefined> {
    try {
      const response = await this.options.fetch(`${this.baseUrl}/v1/publishers/${fingerprint}`, {
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
      if (response.status === 404) return null;
      if (!response.ok) return undefined;
      const answer = (await response.json()) as { name?: unknown };
      return typeof answer.name === "string" && NAME.test(answer.name) ? answer.name : null;
    } catch {
      return undefined;
    }
  }
}
