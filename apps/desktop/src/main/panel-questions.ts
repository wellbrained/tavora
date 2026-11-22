import type { Connector } from "@tavora/module-schema";
import type { GrantStore } from "./grants";
import type { Installed } from "./installed-modules";
import type { LeaderboardQuestion } from "./leaderboards";
import { sameOwner } from "./module-owner";
import type { PanelViews } from "./panel-views";
import type { PendingQuestions } from "./pending-questions";
import type { InstanceRecord } from "./workspace";

export interface PanelQuestionsOptions {
  /** Every open question; the connector and leaderboard questions are among them. */
  questions: PendingQuestions;
  installed: Installed;
  grants: Pick<GrantStore, "grant">;
  /** The panels' views: which wait for their module's access, and placing them again once a question shows or goes. */
  panels: Pick<PanelViews, "isAwaiting" | "applyBounds">;
  /** The panels of the workspace shown now; none on Home or another page. */
  shownPanels: () => readonly InstanceRecord[];
  /** Something the host UI shows changed. */
  pushState: () => void;
}

/**
 * The questions Tavora shows in a panel's place (decision of 2026-10-28): its module's access before its page starts, a
 * connector it asks for on request, and its leaderboards' question. The panel that shows one hides its page meanwhile;
 * everything that asks hears the answer once it counts.
 */
export class PanelQuestions {
  constructor(private readonly options: PanelQuestionsOptions) {}

  /**
   * What a panel shows in its place now. Panels added while their module still misses access it needs: the first of
   * them asks, the others wait, and none starts its page until the user allows. A running module that asks for a
   * connector on request: its first panel shows the question over its page; its other panels go on. A panel that
   * already runs while its module asks for more (a local update) keeps running with what was granted and offers a
   * review instead. `records` are the panels of the panel's workspace.
   */
  of(record: InstanceRecord, records: readonly InstanceRecord[]): "ask" | "wait" | null {
    const { panels, questions } = this.options;
    if (panels.isAwaiting(record.instanceId)) {
      const asking = records.find((item) => item.moduleId === record.moduleId && panels.isAwaiting(item.instanceId));
      return asking?.instanceId === record.instanceId ? "ask" : "wait";
    }
    // The leaderboards' question shows in the panel that asked for it.
    const board = questions.peek("leaderboard");
    if (board && "panel" in board.scope && board.scope.panel === record.instanceId) return "ask";
    const first = records.find((item) => item.moduleId === record.moduleId)?.instanceId === record.instanceId;
    return first && questions.peek("connector")?.payload.moduleId === record.moduleId ? "ask" : null;
  }

  /** Whether the panel shows a question in its place now: its page waits, hidden, until it is answered. */
  asking(instanceId: string): boolean {
    const shown = this.options.shownPanels();
    const record = shown.find((item) => item.instanceId === instanceId);
    return !!record && this.of(record, shown) === "ask";
  }

  /**
   * Shows Tavora's consent question for one connector a module asks for on request, after a click in its panel; resolves
   * with whether the user allowed it. `module` is the owner whose page asked and the module id. A newer request closes
   * an older one as not allowed, and so does closing the module's last panel or its panels starting as another owner's.
   */
  askConnector(module: { owner: string; id: string }, connector: Connector): Promise<boolean> {
    const { answer } = this.options.questions.ask("connector", { module: module.id }, { moduleId: module.id, owner: module.owner, connector });
    this.changed();
    return answer;
  }

  /**
   * The user's answer; allowing grants that connector alone, and its panels go on with it. Only while the copy installed
   * now is the asking owner's and asks for it: when the id changed hands meanwhile, nobody is granted anything and the
   * asker hears no.
   */
  async answerConnector(id: number, allow: boolean): Promise<void> {
    const { questions, installed, grants } = this.options;
    const pending = questions.peek("connector");
    if (!pending || pending.id !== id) return;
    const { moduleId, owner, connector } = pending.payload;
    const module = sameOwner({ owner, manifest: { id: moduleId } }, installed.modules);
    const grant = async (): Promise<boolean> => {
      const granted = allow && module !== undefined && (module.manifest.permissions.onRequest ?? []).includes(connector);
      if (granted) await grants.grant(module, { network: [], connectors: [connector], folders: [] });
      return granted;
    };
    // The question is gone now; the module hears the answer once the grant is stored.
    const result = grant();
    questions.answer(id, result);
    await result;
    this.changed();
  }

  /**
   * Shows Tavora's question about a module's leaderboards in the panel that asked (leaderboards.show, after a click
   * there); resolves with the user's answer. A newer question closes an older one as no.
   */
  askLeaderboard(instanceId: string, moduleId: string, question: LeaderboardQuestion): Promise<boolean> {
    const { answer } = this.options.questions.ask("leaderboard", { panel: instanceId }, { moduleId, question });
    this.changed();
    return answer;
  }

  /** A module's panels start again as another owner's (ModulePanels): a connector question its old page asked ends as not allowed. */
  ownerChanged(moduleId: string): void {
    if (this.options.questions.cancel({ module: moduleId }, "connector") > 0) this.changed();
  }

  /** The user's answer; the panel's page comes back either way. */
  answerLeaderboard(id: number, yes: boolean): void {
    const { questions } = this.options;
    if (questions.peek("leaderboard")?.id !== id) return;
    questions.answer(id, yes);
    this.changed();
  }

  /** A question showed or went: the host UI shows it, and the panels' views step aside or come back. */
  private changed(): void {
    this.options.pushState();
    this.options.panels.applyBounds();
  }
}
