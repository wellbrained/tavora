// Module grants (the decision log, module grants row of 2026-10-16): the user's stored yes to
// what a module asks for in `permissions`. Kept in grants.json in the data folder, outside every
// module's own folder, for the module's owner (publisher) and id, with the version that was granted.
// A grant only covers what the module's current manifest still asks for, and every gated call
// checks it again, so revoking takes effect at once.
import path from "node:path";
import { connectorsAtAdd, folderKey, isConnector, isModuleId, isNetworkEntry, isOwnerId, parseFolderKey, withGamePanelType, type Connector, type ModuleManifest } from "@tavora/module-schema";
import { SAVED_FILES, SavedFile } from "./saved-file";

export const GRANTS_FILE = "grants.json";

/** What a module may do, as far as grants decide it. */
export interface Permissions {
  /** Hosts for network.fetch. */
  network: string[];
  /** Connectors whose sign-in the module may use (ai-usage). */
  connectors: Connector[];
  /** Folders on this PC to read, each as its folderKey (path and both extension lists). */
  folders: string[];
  /**
   * Running a panel hidden while the module's game runs (a panel type's `withGame`). In what is asked, missing or
   * allowed it is true or left out; in a stored grant, false means the user switched it off in Settings, which counts
   * as answered, so it isn't asked again until a version newly asks for it (catalog-updates.ts newAsks).
   */
  withGame?: boolean;
}

export interface Grant extends Permissions {
  /** The module version the user last answered for. */
  version: string;
  /** When the user last granted something to it. */
  grantedAt: string;
  /**
   * With `withGame` true: the games (the manifest's `games`) the yes was for. A version made for a game not in it is
   * asked again, as when it first brought `withGame`.
   */
  withGameFor?: string[];
}

/** The module a grant is for: who publishes it and what it asks for. */
export interface GrantSubject {
  owner: string;
  /** `games`: the games it is made for; left out, none (only test subjects and modules that don't run with a game). */
  manifest: Pick<ModuleManifest, "id" | "version" | "permissions" | "panels"> & { games?: readonly string[] };
}

type GrantFile = { version: number; owners: Record<string, Record<string, Grant>> };

const EMPTY: Permissions = { network: [], connectors: [], folders: [] };

/** What a manifest asks for, with the optional connectors filled in. */
function asked(manifest: GrantSubject["manifest"]): Permissions {
  return {
    network: manifest.permissions.network,
    connectors: manifest.permissions.connectors ?? [],
    folders: (manifest.permissions.folders ?? []).map(folderKey),
    ...(asksWithGame(manifest) ? { withGame: true } : {}),
  };
}

/** Whether the module asks to run a panel while its game runs (one of its panel types has `withGame`). */
export function asksWithGame(manifest: Pick<ModuleManifest, "panels">): boolean {
  return withGamePanelType(manifest) !== null;
}

/** Whether a stored yes to running with the game covers every game the manifest is made for now. */
function withGameCovers(manifest: GrantSubject["manifest"], grant: Grant | undefined): boolean {
  if (grant?.withGame !== true) return false;
  const covered = new Set(grant.withGameFor ?? []);
  return (manifest.games ?? []).every((game) => covered.has(game));
}

function sanitizeGrant(value: unknown): Grant | null {
  if (typeof value !== "object" || value === null) return null;
  const { version, grantedAt, network, connectors = [], folders = [], withGame, withGameFor } = value as Record<string, unknown>;
  if (typeof version !== "string" || typeof grantedAt !== "string" || !Array.isArray(network) || !Array.isArray(connectors) || !Array.isArray(folders)) return null;
  return {
    version,
    grantedAt,
    network: [...new Set(network.filter(isNetworkEntry))],
    connectors: [...new Set(connectors.filter(isConnector))],
    folders: [...new Set(folders.filter((key): key is string => parseFolderKey(key) !== null))],
    // Anything but true or false is as if never answered.
    ...(typeof withGame === "boolean" ? { withGame } : {}),
    ...(withGame === true && Array.isArray(withGameFor) ? { withGameFor: [...new Set(withGameFor.filter((game): game is string => typeof game === "string"))] } : {}),
  };
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

/**
 * What the manifest asks for that the grant does not cover yet, as the consent dialog asks it when the module is added:
 * connectors it asks for on request (permissions.onRequest) wait until the module first needs them.
 */
export function missingPermissions(manifest: GrantSubject["manifest"], grant: Grant | undefined): Permissions {
  const ask = { network: manifest.permissions.network, connectors: connectorsAtAdd(manifest.permissions), folders: asked(manifest).folders };
  const hosts = new Set(grant?.network ?? []);
  const connectors = new Set(grant?.connectors ?? []);
  const folders = new Set(grant?.folders ?? []);
  return {
    network: ask.network.filter((host) => !hosts.has(host)),
    connectors: ask.connectors.filter((name) => !connectors.has(name)),
    folders: ask.folders.filter((key) => !folders.has(key)),
    // Switched off in Settings is an answer too; a yes for other games than the module is made for now is not.
    ...(asksWithGame(manifest) && (grant?.withGame === undefined || (grant.withGame === true && !withGameCovers(manifest, grant))) ? { withGame: true } : {}),
  };
}

/** What a grant allows now: only what the current manifest still asks for. */
export function effectivePermissions(manifest: GrantSubject["manifest"], grant: Grant | undefined): Permissions {
  if (!grant) return EMPTY;
  const ask = asked(manifest);
  const hosts = new Set(grant.network);
  const connectors = new Set(grant.connectors);
  const folders = new Set(grant.folders);
  return {
    network: ask.network.filter((host) => hosts.has(host)),
    connectors: ask.connectors.filter((name) => connectors.has(name)),
    folders: ask.folders.filter((key) => folders.has(key)),
    ...(ask.withGame && withGameCovers(manifest, grant) ? { withGame: true } : {}),
  };
}

export class GrantStore {
  private constructor(
    private readonly file: SavedFile,
    private readonly owners: Map<string, Map<string, Grant>>,
    private readonly now: () => Date,
  ) {}

  static async load(userData: string, now: () => Date = () => new Date()): Promise<GrantStore> {
    const file = new SavedFile(path.join(userData, GRANTS_FILE), SAVED_FILES[GRANTS_FILE]);
    return new GrantStore(file, sanitizeGrants(await file.read()), now);
  }

  /** The stored grant of a module, whatever its current manifest asks for. */
  get(owner: string, moduleId: string): Readonly<Grant> | undefined {
    return this.owners.get(owner)?.get(moduleId);
  }

  /** What the module may do right now. Asked on every gated call. */
  allowed(subject: GrantSubject): Permissions {
    return effectivePermissions(subject.manifest, this.get(subject.owner, subject.manifest.id));
  }

  /** What the module asks for and the user has not granted. */
  missing(subject: GrantSubject): Permissions {
    return missingPermissions(subject.manifest, this.get(subject.owner, subject.manifest.id));
  }

  /**
   * Records the user's yes to some of what the module asks for (all of it when `what` is left out).
   * Only what the manifest asks for can be granted; what was granted before stays.
   */
  grant(subject: GrantSubject, what: Permissions = asked(subject.manifest)): Promise<void> {
    const { owner, manifest } = subject;
    const ask = asked(manifest);
    const previous = this.get(owner, manifest.id);
    const network = [...new Set([...(previous?.network ?? []), ...what.network.filter((host) => ask.network.includes(host))])];
    const connectors = [...new Set([...(previous?.connectors ?? []), ...what.connectors.filter((name) => ask.connectors.includes(name))])];
    const folders = [...new Set([...(previous?.folders ?? []), ...what.folders.filter((key) => ask.folders.includes(key))])];
    // Granted when asked and shown, for the games it is made for now; else what the user answered before stays (a
    // switch turned off too).
    const answer: Pick<Grant, "withGame" | "withGameFor"> =
      what.withGame === true && ask.withGame === true
        ? { withGame: true, withGameFor: [...(manifest.games ?? [])] }
        : { ...(previous?.withGame !== undefined ? { withGame: previous.withGame } : {}), ...(previous?.withGameFor ? { withGameFor: previous.withGameFor } : {}) };
    if (!this.owners.has(owner)) this.owners.set(owner, new Map());
    this.owners.get(owner)!.set(manifest.id, { version: manifest.version, grantedAt: this.now().toISOString(), network, connectors, folders, ...answer });
    return this.save();
  }

  /**
   * Settings > Connections, "Runs while its game runs": the switch for a module that asks for it. Off is kept as an
   * answer, so the module isn't asked again; on is the user's yes. Nothing else of the grant changes.
   */
  setWithGame(subject: GrantSubject, on: boolean): Promise<void> {
    const { owner, manifest } = subject;
    if (!asksWithGame(manifest)) return Promise.resolve();
    const previous = this.get(owner, manifest.id);
    const now = this.now().toISOString();
    const { withGameFor: _games, ...base } = previous ?? { version: manifest.version, grantedAt: now, network: [], connectors: [], folders: [] };
    if (!this.owners.has(owner)) this.owners.set(owner, new Map());
    this.owners.get(owner)!.set(manifest.id, { ...base, ...(on ? { grantedAt: now, withGame: true, withGameFor: [...(manifest.games ?? [])] } : { withGame: false }) });
    return this.save();
  }

  /**
   * A version that no longer asks to run with its game forgets the answer, yes or off: a later version that brings it
   * back asks again, however it was installed (the catalog's updates ask as well, catalog-updates.ts newAsks).
   * Resolves true when there was an answer to forget.
   */
  async forgetWithGame(subject: GrantSubject): Promise<boolean> {
    const { owner, manifest } = subject;
    const previous = this.get(owner, manifest.id);
    if (asksWithGame(manifest) || previous?.withGame === undefined) return false;
    const { withGame: _answer, withGameFor: _games, ...rest } = previous;
    this.owners.get(owner)!.set(manifest.id, rest);
    await this.save();
    return true;
  }

  /** Takes back some of a module's grant, or all of it when `what` is left out. Takes effect at the next call. */
  revoke(owner: string, moduleId: string, what?: Permissions): Promise<void> {
    const previous = this.get(owner, moduleId);
    if (!previous) return Promise.resolve();
    const takenHosts = new Set(what?.network ?? previous.network);
    const takenConnectors = new Set(what?.connectors ?? previous.connectors);
    const takenFolders = new Set(what?.folders ?? previous.folders);
    const network = previous.network.filter((host) => !takenHosts.has(host));
    const connectors = previous.connectors.filter((name) => !takenConnectors.has(name));
    const folders = previous.folders.filter((key) => !takenFolders.has(key));
    // Taken back on its own, running with the game stays answered (off), so it isn't asked again.
    const off = what?.withGame === true && previous.withGame !== undefined;
    const withGame = off ? false : previous.withGame;
    if (what && (network.length + connectors.length + folders.length > 0 || withGame !== undefined)) {
      const { withGameFor, ...kept } = previous;
      this.owners.get(owner)!.set(moduleId, { ...kept, network, connectors, folders, ...(withGame !== undefined ? { withGame } : {}), ...(!off && withGameFor ? { withGameFor } : {}) });
    }
    else this.owners.get(owner)!.delete(moduleId);
    if (this.owners.get(owner)!.size === 0) this.owners.delete(owner);
    return this.save();
  }

  private save(): Promise<void> {
    const owners: GrantFile["owners"] = {};
    for (const [owner, modules] of this.owners) owners[owner] = Object.fromEntries(modules);
    return this.file.write({ owners });
  }
}
