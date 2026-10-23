// Worlds and plans as module documents. Both kinds share the module's document
// list and are told apart by their format; ids start with "world-" or "plan-"
// so a deleted document's kind is still known. Documents of a broken shape are
// left out rather than breaking the list; ids the game data no longer has are
// kept, for the solver to report.

import { TavoraError, type DocumentSummary, type JsonValue, type TavoraDocument, type TavoraSDK } from "@tavora/sdk";
import type { GameData } from "../contracts/data";
import type { Plan, World } from "../contracts/plan";
import type { Repository, RepositoryChange, Stored } from "../contracts/repository";
import { LIMITS, PLAN_FILE_FORMAT, PLAN_FORMAT, WORLD_FORMAT, readPlan, readPlanFile, readWorld, type PlanFile } from "./validate";
import { newWorld } from "./world";

type Kind = RepositoryChange["kind"];

/** The world ensureWorld creates, under one id so two panels starting at once make only one. */
export const FIRST_WORLD_ID = "world-first";

export interface RepositoryOptions {
  data: GameData;
  /** Tavora's language, such as "en" or "de", or a function that reads the current one. Names the first world. */
  language: string | (() => string);
}

interface Known {
  revision: number;
  kind: Kind | null;
  /** The checked value, or null when the document did not pass the checks. */
  value: World | Plan | null;
}

export class DocumentRepository implements Repository {
  private readonly data: GameData;
  private readonly language: () => string;
  /** What this panel last read of each document, so unchanged ones are not fetched again. */
  private readonly known = new Map<string, Known>();

  constructor(
    private readonly sdk: TavoraSDK,
    options: RepositoryOptions,
  ) {
    this.data = options.data;
    const language = options.language;
    this.language = typeof language === "function" ? language : () => language;
  }

  listWorlds(): Promise<Stored<World>[]> {
    return this.list("world") as Promise<Stored<World>[]>;
  }

  async getWorld(id: string): Promise<Stored<World> | null> {
    return (await this.get(id, "world")) as Stored<World> | null;
  }

  async ensureWorld(): Promise<Stored<World>> {
    const [first] = await this.listWorlds();
    if (first) return first;
    const world = newWorld(this.language().toLowerCase().startsWith("de") ? "Meine Welt" : "My world");
    try {
      return await this.putWorld(world, { id: FIRST_WORLD_ID, ifRevision: 0 });
    } catch (error) {
      // Another panel created it first.
      const existing = isConflict(error) ? await this.getWorld(FIRST_WORLD_ID) : null;
      if (existing) return existing;
      throw error;
    }
  }

  async putWorld(world: World, options: { id?: string; ifRevision?: number } = {}): Promise<Stored<World>> {
    return this.put("world", readWorld(world), options);
  }

  async deleteWorld(id: string): Promise<void> {
    const plans = await this.listPlans();
    if (plans.some((plan) => plan.value.worldId === id)) throw new Error("This world still has plans. Delete them or move them to another world first.");
    await this.sdk.documents.delete(id);
    this.known.delete(id);
  }

  listPlans(): Promise<Stored<Plan>[]> {
    return this.list("plan") as Promise<Stored<Plan>[]>;
  }

  async getPlan(id: string): Promise<Stored<Plan> | null> {
    return (await this.get(id, "plan")) as Stored<Plan> | null;
  }

  async putPlan(plan: Plan, options: { id?: string; ifRevision?: number } = {}): Promise<Stored<Plan>> {
    const value = readPlan(plan);
    if (!(await this.getWorld(value.worldId))) throw new Error("This plan's world is gone. Choose another world.");
    return this.put("plan", value, options);
  }

  async deletePlan(id: string, options: { ifRevision?: number } = {}): Promise<void> {
    await this.sdk.documents.delete(id, options);
    this.known.delete(id);
  }

  async exportPlan(id: string): Promise<JsonValue> {
    const plan = await this.getPlan(id);
    if (!plan) throw new Error("This plan is gone.");
    const file: PlanFile = { format: PLAN_FILE_FORMAT, version: 1, gameBuild: this.data.game.build, plan: plan.value };
    if (new TextEncoder().encode(JSON.stringify(file)).byteLength > LIMITS.exportBytes) throw new Error("This plan is too big to export.");
    return file as unknown as JsonValue;
  }

  async importPlan(file: unknown, worldId: string): Promise<Stored<Plan>> {
    return this.putPlan(readPlanFile(file, this.data, worldId));
  }

  onChange(fn: (change: RepositoryChange) => void): () => void {
    return this.sdk.documents.onChange((change) => {
      void this.kindOf(change.id, change.revision, change.deleted).then((kind) => {
        if (kind) fn({ kind, id: change.id, deleted: change.deleted });
      });
    });
  }

  private async list(kind: Kind): Promise<Stored<World | Plan>[]> {
    const summaries = await this.sdk.documents.list();
    const stored = await Promise.all(
      summaries.map(async (summary) => {
        const known = this.known.get(summary.id);
        if (known && known.revision === summary.revision) return known.kind === kind && known.value ? toStored(summary, known.value) : null;
        const document = await this.sdk.documents.get(summary.id);
        return document ? this.read(document, kind) : null;
      }),
    );
    return stored
      .filter((entry): entry is Stored<World | Plan> => entry !== null)
      .sort((a, b) => a.value.name.localeCompare(b.value.name, undefined, { sensitivity: "base" }) || (a.id < b.id ? -1 : 1));
  }

  private async get(id: string, kind: Kind): Promise<Stored<World | Plan> | null> {
    const document = await this.sdk.documents.get(id);
    if (!document) {
      this.known.delete(id);
      return null;
    }
    return this.read(document, kind);
  }

  /** The document as a valid `kind`, or null. */
  private read(document: TavoraDocument, kind: Kind): Stored<World | Plan> | null {
    const known = this.remember(document);
    return known.kind === kind && known.value ? toStored(document, known.value) : null;
  }

  /** Checks a fetched document and keeps what came out. */
  private remember(document: TavoraDocument): Known {
    const kind = formatKind(document.data);
    let value: World | Plan | null = null;
    try {
      if (kind === "world") value = readWorld(document.data);
      if (kind === "plan") value = readPlan(document.data);
    } catch {
      value = null;
    }
    const known = { revision: document.revision, kind, value };
    this.known.set(document.id, known);
    return known;
  }

  private async put<T extends World | Plan>(kind: Kind, value: T, options: { id?: string; ifRevision?: number }): Promise<Stored<T>> {
    const id = options.id ?? `${kind}-${crypto.randomUUID()}`;
    // A new id must not replace anything that is already there.
    const ifRevision = options.id === undefined ? 0 : options.ifRevision;
    const summary = await this.sdk.documents.put({
      id,
      title: value.name,
      data: value as unknown as JsonValue,
      ...(ifRevision === undefined ? {} : { ifRevision }),
    });
    this.known.set(summary.id, { revision: summary.revision, kind, value });
    return toStored(summary, value);
  }

  private async kindOf(id: string, revision: number, deleted: boolean): Promise<Kind | null> {
    const known = this.known.get(id);
    if (deleted) {
      this.known.delete(id);
      return known?.kind ?? prefixKind(id);
    }
    if (known && known.revision === revision && known.kind) return known.kind;
    try {
      const document = await this.sdk.documents.get(id);
      if (!document) return known?.kind ?? prefixKind(id);
      return this.remember(document).kind;
    } catch {
      return known?.kind ?? prefixKind(id);
    }
  }
}

/** A copy, so a caller changing it does not change what this panel remembers. */
function toStored<T>(summary: DocumentSummary, value: T): Stored<T> {
  return { id: summary.id, revision: summary.revision, updatedAt: summary.updatedAt, value: structuredClone(value) };
}

function formatKind(data: unknown): Kind | null {
  if (typeof data !== "object" || data === null) return null;
  const format = (data as { format?: unknown }).format;
  return format === WORLD_FORMAT ? "world" : format === PLAN_FORMAT ? "plan" : null;
}

function prefixKind(id: string): Kind | null {
  return id.startsWith("world-") ? "world" : id.startsWith("plan-") ? "plan" : null;
}

function isConflict(error: unknown): boolean {
  return error instanceof TavoraError && error.code === "CONFLICT";
}
