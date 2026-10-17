// Module grants (the decision log, module grants row of 2026-10-16): the player's stored yes to
// what a module asks for in `permissions`. Kept in grants.json in the data folder, outside every
// module's own folder, for the module's owner (publisher) and id, with the version that was granted.
// A grant only covers what the module's current manifest still asks for, and every gated call
// checks it again, so revoking takes effect at once.
import path from "node:path";
import { isConnector, isModuleId, isNetworkHost, isOwnerId, type Connector, type ModuleManifest } from "@tavora/module-schema";
import { SerialQueue, writeFileAtomic } from "./fsutil";
import { readJsonOrSetAside } from "./json";

export const GRANTS_FILE = "grants.json";
/** The format of grants.json; raised when an older Tavora could misread it (see backup.ts). */
export const GRANTS_VERSION = 1;

/** What a module may do, as far as grants decide it. */
export interface Permissions {
  /** Hosts for network.fetch. */
  network: string[];
  /** Connectors whose sign-in the module may use (ai-usage). */
  connectors: Connector[];
}

export interface Grant extends Permissions {
  /** The module version the player last answered for. */
  version: string;
  /** When the player last granted something to it. */
  grantedAt: string;
}

/** The module a grant is for: who publishes it and what it asks for. */
export interface GrantSubject {
  owner: string;
  manifest: Pick<ModuleManifest, "id" | "version" | "permissions">;
}

type GrantFile = { version: number; owners: Record<string, Record<string, Grant>> };

const EMPTY: Permissions = { network: [], connectors: [] };

/** What a manifest asks for, with the optional connectors filled in. */
function asked(manifest: GrantSubject["manifest"]): Permissions {
  return { network: manifest.permissions.network, connectors: manifest.permissions.connectors ?? [] };
}

function sanitizeGrant(value: unknown): Grant | null {
  if (typeof value !== "object" || value === null) return null;
  const { version, grantedAt, network, connectors = [] } = value as Record<string, unknown>;
  if (typeof version !== "string" || typeof grantedAt !== "string" || !Array.isArray(network) || !Array.isArray(connectors)) return null;
  return { version, grantedAt, network: [...new Set(network.filter(isNetworkHost))], connectors: [...new Set(connectors.filter(isConnector))] };
}

/** Reads grants.json, keeping only well-formed entries; anything else is as if never granted. */
export function sanitizeGrants(raw: unknown): Map<string, Map<string, Grant>> {
  const owners = new Map<string, Map<string, Grant>>();
  const source = (raw as Partial<GrantFile> | null)?.owners;
  if (typeof source !== "object" || source === null) return owners;
  for (const [owner, modules] of Object.entries(source)) {
    if (!isOwnerId(owner) || typeof modules !== "object" || modules === null) continue;
    for (const [id, value] of Object.entries(modules)) {
      const grant = sanitizeGrant(value);
      if (!isModuleId(id) || !grant) continue;
      if (!owners.has(owner)) owners.set(owner, new Map());
      owners.get(owner)!.set(id, grant);
    }
  }
  return owners;
}

/** What the manifest asks for that the grant does not cover yet. */
export function missingPermissions(manifest: GrantSubject["manifest"], grant: Grant | undefined): Permissions {
  const ask = asked(manifest);
  const hosts = new Set(grant?.network ?? []);
  const connectors = new Set(grant?.connectors ?? []);
  return { network: ask.network.filter((host) => !hosts.has(host)), connectors: ask.connectors.filter((name) => !connectors.has(name)) };
}

/** What a grant allows now: only what the current manifest still asks for. */
export function effectivePermissions(manifest: GrantSubject["manifest"], grant: Grant | undefined): Permissions {
  if (!grant) return EMPTY;
  const ask = asked(manifest);
  const hosts = new Set(grant.network);
  const connectors = new Set(grant.connectors);
  return { network: ask.network.filter((host) => hosts.has(host)), connectors: ask.connectors.filter((name) => connectors.has(name)) };
}

export class GrantStore {
  private readonly queue = new SerialQueue();

  private constructor(
    private readonly file: string,
    private readonly owners: Map<string, Map<string, Grant>>,
    private readonly now: () => Date,
  ) {}

  static async load(userData: string, now: () => Date = () => new Date()): Promise<GrantStore> {
    const file = path.join(userData, GRANTS_FILE);
    return new GrantStore(file, sanitizeGrants(await readJsonOrSetAside(file)), now);
  }

  /** The stored grant of a module, whatever its current manifest asks for. */
  get(owner: string, moduleId: string): Readonly<Grant> | undefined {
    return this.owners.get(owner)?.get(moduleId);
  }

  /** What the module may do right now. Asked on every gated call. */
  allowed(subject: GrantSubject): Permissions {
    return effectivePermissions(subject.manifest, this.get(subject.owner, subject.manifest.id));
  }

  /** What the module asks for and the player has not granted. */
  missing(subject: GrantSubject): Permissions {
    return missingPermissions(subject.manifest, this.get(subject.owner, subject.manifest.id));
  }

  /**
   * Records the player's yes to some of what the module asks for (all of it when `what` is left out).
   * Only what the manifest asks for can be granted; what was granted before stays.
   */
  grant(subject: GrantSubject, what: Permissions = asked(subject.manifest)): Promise<void> {
    const { owner, manifest } = subject;
    const ask = asked(manifest);
    const previous = this.get(owner, manifest.id);
    const network = [...new Set([...(previous?.network ?? []), ...what.network.filter((host) => ask.network.includes(host))])];
    const connectors = [...new Set([...(previous?.connectors ?? []), ...what.connectors.filter((name) => ask.connectors.includes(name))])];
    if (!this.owners.has(owner)) this.owners.set(owner, new Map());
    this.owners.get(owner)!.set(manifest.id, { version: manifest.version, grantedAt: this.now().toISOString(), network, connectors });
    return this.save();
  }

  /** Takes back some of a module's grant, or all of it when `what` is left out. Takes effect at the next call. */
  revoke(owner: string, moduleId: string, what?: Permissions): Promise<void> {
    const previous = this.get(owner, moduleId);
    if (!previous) return Promise.resolve();
    const takenHosts = new Set(what?.network ?? previous.network);
    const takenConnectors = new Set(what?.connectors ?? previous.connectors);
    const network = previous.network.filter((host) => !takenHosts.has(host));
    const connectors = previous.connectors.filter((name) => !takenConnectors.has(name));
    if (what && network.length + connectors.length > 0) this.owners.get(owner)!.set(moduleId, { ...previous, network, connectors });
    else this.owners.get(owner)!.delete(moduleId);
    if (this.owners.get(owner)!.size === 0) this.owners.delete(owner);
    return this.save();
  }

  private save(): Promise<void> {
    const body: GrantFile = { version: GRANTS_VERSION, owners: {} };
    for (const [owner, modules] of this.owners) body.owners[owner] = Object.fromEntries(modules);
    const text = `${JSON.stringify(body, null, 2)}\n`;
    return this.queue.run(() => writeFileAtomic(this.file, text));
  }
}
