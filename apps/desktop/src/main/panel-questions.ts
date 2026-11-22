import type { LeaderboardQuestion } from "./leaderboards";
import type { ConnectorQuestions } from "./panel-gate";
import type { PanelViews } from "./panel-views";
import type { PendingQuestions } from "./pending-questions";
import type { InstanceRecord } from "./workspace";

export interface PanelQuestionsOptions {
  /** Every open question; the leaderboard question is among them. */
  questions: PendingQuestions;
  /** The connector question a module asked for on request (panel-gate.ts): asked, matched and answered there. */
  connectors: Pick<ConnectorQuestions, "isFor">;
  /** The panels' views: which wait for their module's access, and placing them again once a question shows or goes. */
  panels: Pick<PanelViews, "isAwaiting" | "applyBounds">;
  /** The panels of the workspace shown now; none on Home or another page. */
  shownPanels: () => readonly InstanceRecord[];
  /** Something the host UI shows changed. */
  pushState: () => void;
}

/**
 * The questions Tavora shows in a panel's place (decision of 2026-10-28): its module's access before its page starts, a
 * connector it asks for on request (ConnectorQuestions, panel-gate.ts, says which), and its leaderboards' question. The
 * panel that shows one hides its page meanwhile; everything that asks hears the answer once it counts.
 */
export class PanelQuestions {
  constructor(private readonly options: PanelQuestionsOptions) {}

  /**
   * What a panel shows in its place now. Panels added while their module still misses access it needs: the first of
   * them asks, the others wait, and none starts its page until the user allows. A running module that asks for a
   * connector on request: its first panel shows the question over its page; its other panels go on. A panel that
   * already runs while its module asks for more (a local update) keeps running with what was granted and offers a
   * review instead. A connector question is the asking owner's: it shows only in a panel that runs as that owner.
   * `records` are the panels of the panel's workspace.
   */
  of(record: InstanceRecord, records: readonly InstanceRecord[]): "ask" | "wait" | null {
    const { panels, questions, connectors } = this.options;
    if (panels.isAwaiting(record.instanceId)) {
      const asking = records.find((item) => item.moduleId === record.moduleId && panels.isAwaiting(item.instanceId));
      return asking?.instanceId === record.instanceId ? "ask" : "wait";
    }
    // The leaderboards' question shows in the panel that asked for it.
    const board = questions.peek("leaderboard");
    if (board && "panel" in board.scope && board.scope.panel === record.instanceId) return "ask";
    if (!connectors.isFor(record)) return null;
    const first = records.find((item) => connectors.isFor(item))?.instanceId === record.instanceId;
    return first ? "ask" : null;
  }

  /** Whether the panel shows a question in its place now: its page waits, hidden, until it is answered. */
  asking(instanceId: string): boolean {
    const shown = this.options.shownPanels();
    const record = shown.find((item) => item.instanceId === instanceId);
    return !!record && this.of(record, shown) === "ask";
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
