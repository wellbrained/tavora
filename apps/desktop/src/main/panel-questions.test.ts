import { describe, expect, it } from "vitest";
import { Installed } from "./installed-modules";
import { PanelQuestions } from "./panel-questions";
import { PendingQuestions } from "./pending-questions";
import type { InstalledModule } from "./registry";
import type { InstanceRecord } from "./workspace";

const media = { owner: "abcd1234", manifest: { id: "wellbrained.media", name: "Media", permissions: { network: [], onRequest: ["media"] } } } as unknown as InstalledModule;

function setup(options: { awaiting?: string[]; shown?: InstanceRecord[] } = {}) {
  const calls: string[] = [];
  const questions = new PendingQuestions();
  const installed = new Installed({ modules: new Map([[media.manifest.id, media]]), blocked: new Map(), catalog: new Set(), info: new Map(), problems: [] }, (manifest) => manifest);
  const awaiting = new Set(options.awaiting ?? []);
  const panel = new PanelQuestions({
    questions,
    installed,
    grants: { grant: async (module, what) => void calls.push(`grant ${module.manifest.id} ${what?.connectors.join(",")}`) },
    panels: { isAwaiting: (id) => awaiting.has(id), applyBounds: () => void calls.push("bounds") },
    shownPanels: () => options.shown ?? [],
    pushState: () => void calls.push("push"),
  });
  return { panel, calls, questions, awaiting };
}

const records: InstanceRecord[] = [
  { instanceId: "one", moduleId: "wellbrained.media" },
  { instanceId: "two", moduleId: "wellbrained.media" },
  { instanceId: "notes", moduleId: "tavora.notes" },
];

describe("PanelQuestions", () => {
  it("lets the first panel waiting for its module's access ask and the others wait", () => {
    const { panel } = setup({ awaiting: ["one", "two"] });
    expect(records.map((record) => panel.of(record, records))).toEqual(["ask", "wait", null]);
  });

  it("shows a connector question in the module's first panel only, and grants it alone when allowed", async () => {
    const { panel, calls, questions } = setup({ shown: records });
    const answer = panel.askConnector("wellbrained.media", "media");
    expect(calls).toEqual(["push", "bounds"]);
    expect(records.map((record) => panel.of(record, records))).toEqual(["ask", null, null]);
    expect(["one", "two", "notes"].map((id) => panel.asking(id))).toEqual([true, false, false]);

    await panel.answerConnector(questions.peek("connector")!.id, true);
    expect(await answer).toBe(true);
    expect(calls.slice(2)).toEqual(["grant wellbrained.media media", "push", "bounds"]);
    expect(panel.asking("one")).toBe(false);
  });

  it("grants nothing the module installed now doesn't ask for on request, and ignores an answer to an older question", async () => {
    const { panel, calls, questions } = setup();
    const first = panel.askConnector("wellbrained.media", "media");
    const firstId = questions.peek("connector")!.id;
    const second = panel.askConnector("wellbrained.media", "discord");
    // A newer request closes the older one as not allowed.
    expect(await first).toBe(false);
    await panel.answerConnector(firstId, true);
    await panel.answerConnector(questions.peek("connector")!.id, true);
    expect(await second).toBe(false);
    expect(calls.some((call) => call.startsWith("grant"))).toBe(false);
  });

  it("shows a leaderboard question in the panel that asked, whatever its place, and answers it once", async () => {
    const { panel, calls, questions } = setup({ shown: records });
    const answer = panel.askLeaderboard("two", "wellbrained.media", { kind: "sign-in" });
    expect(records.map((record) => panel.of(record, records))).toEqual([null, "ask", null]);
    const id = questions.peek("leaderboard")!.id;
    panel.answerLeaderboard(id + 1, true);
    panel.answerLeaderboard(id, true);
    expect(await answer).toBe(true);
    expect(calls).toEqual(["push", "bounds", "push", "bounds"]);
    expect(panel.of(records[1]!, records)).toBeNull();
  });

  it("says no panel asks while none is shown", () => {
    const { panel } = setup({ awaiting: ["one"], shown: [] });
    expect(panel.asking("one")).toBe(false);
  });
});
