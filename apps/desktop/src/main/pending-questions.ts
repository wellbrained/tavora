import type { Connector } from "@tavora/module-schema";
import type { HostViewState } from "../shared/host-api";
import type { PanelDialogSize } from "./bridge";
import type { LeaderboardQuestion } from "./leaderboards";
import type { PanelContent } from "./panel-content";
import type { InstalledModule } from "./registry";

/** Who a question belongs to: it ends when its panel closes, its workspace is left, or the module's last panel goes. */
export type QuestionScope = { panel: string } | { workspace: string } | { module: string };

/** Every kind of question: what it carries, and what the user (or a cancel) answers. */
interface QuestionKinds {
  /** A web address a module asked to open while the workspace has no Browser panel. */
  link: { payload: { url: string }; answer: "panel" | "system" | "cancel" };
  /** A panel could not switch to the content another asked for: open it in a new panel? What opens is kept here, never taken from the answer. */
  navigation: { payload: { workspaceId: string; moduleId: string; panelType: string; panelName: string; content: PanelContent }; answer: "new-panel" | "cancel" };
  /** A game started while the user chose to be asked. */
  gameSwitch: { payload: { gameId: string }; answer: "switch" | "cancel" };
  /** A connector a module asks for on request; allowed or not. */
  connector: { payload: { moduleId: string; connector: Connector }; answer: boolean };
  /** A module's question about its leaderboards, shown in the panel that asked; yes or no. */
  leaderboard: { payload: { moduleId: string; question: LeaderboardQuestion }; answer: boolean };
  /**
   * A dialog a panel asked for before it was in its slot (in the in-game layer, or just added and not placed yet),
   * waiting for it to be there; true once it opened. `byClick`: a click opened it, so a click beside it closes it.
   */
  dialog: { payload: { module: InstalledModule; size: PanelDialogSize; until: number; byClick: boolean }; answer: boolean };
  /** A module's menu in the host UI; the chosen item's id, or null. */
  menu: { payload: { choices: ReadonlySet<string> }; answer: string | null };
}

export type QuestionKind = keyof QuestionKinds;
export type QuestionPayload<K extends QuestionKind> = QuestionKinds[K]["payload"];
export type QuestionAnswer<K extends QuestionKind> = QuestionKinds[K]["answer"];

/** What a question not answered by the user (cancelled or replaced) comes to. */
const NO_ANSWER: { [K in QuestionKind]: QuestionAnswer<K> } = {
  link: "cancel",
  navigation: "cancel",
  gameSwitch: "cancel",
  connector: false,
  leaderboard: false,
  dialog: false,
  menu: null,
};

/** An open question, as the host reads it. */
export interface OpenQuestion<K extends QuestionKind> {
  id: number;
  scope: QuestionScope;
  payload: QuestionPayload<K>;
}

/** The view fields the host UI derives from the open questions (a menu and a waiting dialog are not among them). */
export type PendingQuestionsView = Pick<HostViewState, "pendingLink" | "pendingNavigation" | "pendingGameSwitch" | "pendingConnector" | "pendingLeaderboard">;

export interface PendingQuestionsOptions {
  /**
   * Kinds whose next ask waits for the one shown now. Any other kind shows one question at a time and a newer ask
   * replaces the older one, which counts as not answered.
   */
  queued?: readonly QuestionKind[];
}

interface Entry {
  id: number;
  kind: QuestionKind;
  scope: QuestionScope;
  payload: unknown;
  resolve(answer: unknown): void;
}

function sameScope(a: QuestionScope, b: QuestionScope): boolean {
  if ("panel" in a) return "panel" in b && a.panel === b.panel;
  if ("workspace" in a) return "workspace" in b && a.workspace === b.workspace;
  return "module" in b && a.module === b.module;
}

/**
 * Every open question to the user: link, navigation, game switch, connector, leaderboard, waiting panel dialog and
 * module menu. One id counter and one cancel rule: a question ends with its answer, or when its scope ends.
 * Knows nothing of windows; the host draws what `snapshot` and `peek` say and calls `cancel` when a panel closes,
 * a workspace is left or a screen is shown.
 */
export class PendingQuestions {
  private nextId = 1;
  /** Open questions per kind, the one shown first; a kind that is not queued holds at most one. */
  private readonly open = new Map<QuestionKind, Entry[]>();
  private readonly queued: ReadonlySet<QuestionKind>;

  constructor(options: PendingQuestionsOptions = {}) {
    this.queued = new Set(options.queued ?? []);
  }

  /** Opens a question. `answer` settles with the user's answer, or with the no-answer of its kind when it is cancelled or replaced. */
  ask<K extends QuestionKind>(kind: K, scope: QuestionScope, payload: QuestionPayload<K>): { id: number; answer: Promise<QuestionAnswer<K>> } {
    const id = this.nextId++;
    const answer = new Promise<QuestionAnswer<K>>((resolve) => {
      const entry: Entry = { id, kind, scope, payload, resolve: resolve as (answer: unknown) => void };
      const list = this.open.get(kind) ?? [];
      if (!this.queued.has(kind)) for (const older of list.splice(0)) older.resolve(NO_ANSWER[kind]);
      list.push(entry);
      this.open.set(kind, list);
    });
    return { id, answer };
  }

  /** The question being shown for a kind (undefined when none). */
  peek<K extends QuestionKind>(kind: K): OpenQuestion<K> | undefined {
    const entry = this.open.get(kind)?.[0];
    return entry && { id: entry.id, scope: entry.scope, payload: entry.payload as QuestionPayload<K> };
  }

  /**
   * The user's answer. The question is gone at once; an answer still being worked out (a promise) settles the asker when it is done.
   * False for an id that is not open (answered, cancelled or never asked).
   */
  answer<K extends QuestionKind>(id: number, answer: QuestionAnswer<K> | Promise<QuestionAnswer<K>>): boolean {
    const entry = this.take((item) => item.id === id)[0];
    if (!entry) return false;
    entry.resolve(answer);
    return true;
  }

  /** Cancels one question by id, or every question of a scope (of one kind, when given). Returns how many ended. */
  cancel(target: number | QuestionScope, kind?: QuestionKind): number {
    const match = typeof target === "number" ? (item: Entry) => item.id === target : (item: Entry) => sameScope(item.scope, target) && (kind === undefined || item.kind === kind);
    return this.end(this.take(match));
  }

  /** Cancels every question of a kind, whatever its scope. */
  cancelKind(kind: QuestionKind): number {
    return this.end(this.take((item) => item.kind === kind));
  }

  /** What the host UI shows now. */
  snapshot(): PendingQuestionsView {
    const navigation = this.peek("navigation")?.payload;
    const connector = this.peek("connector");
    const board = this.peek("leaderboard");
    return {
      pendingLink: this.peek("link")?.payload.url ?? null,
      pendingNavigation: navigation ? { panel: navigation.panelName, content: navigation.content.title } : null,
      pendingGameSwitch: this.peek("gameSwitch")?.payload.gameId ?? null,
      pendingConnector: connector ? { id: connector.id, moduleId: connector.payload.moduleId, connectors: [connector.payload.connector] } : null,
      pendingLeaderboard: board ? { id: board.id, instanceId: "panel" in board.scope ? board.scope.panel : "", moduleId: board.payload.moduleId, ...board.payload.question } : null,
    };
  }

  private take(match: (entry: Entry) => boolean): Entry[] {
    const taken: Entry[] = [];
    for (const [kind, list] of this.open) {
      const keep = list.filter((entry) => !match(entry) || (taken.push(entry), false));
      if (keep.length) this.open.set(kind, keep);
      else this.open.delete(kind);
    }
    return taken;
  }

  private end(entries: Entry[]): number {
    for (const entry of entries) entry.resolve(NO_ANSWER[entry.kind]);
    return entries.length;
  }
}
