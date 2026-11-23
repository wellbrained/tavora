import { describe, expect, it } from "vitest";
import { Installed } from "./installed-modules";
import { ConnectorQuestions } from "./panel-gate";
import { PanelQuestions } from "./panel-questions";
import { PendingQuestions } from "./pending-questions";
import type { InstalledModule } from "./registry";
import type { InstanceRecord } from "./workspace";

const media = { owner: "abcd1234", manifest: { id: "wellbrained.media", name: "Media", permissions: { network: [], onRequest: ["media"] } } } as unknown as InstalledModule;
/** A development folder that took media's id over, asking for the same connector. */
const localMedia = { ...media, owner: "local" } as InstalledModule;
/** The page that asks: media's, as installed. */
const asker = media;
/** A page of an older copy that also asked for discord on request, which the copy installed now no longer does. */
const olderAsker = { owner: "abcd1234", manifest: { id: "wellbrained.media", permissions: { onRequest: ["media", "discord"] } } } as const;
const copyLink = { name: "overlay.copyLink", capability: "overlay" } as const;

function setup(options: { awaiting?: string[]; shown?: InstanceRecord[] } = {}) {
  const calls: string[] = [];
  const questions = new PendingQuestions({ installedOwner: (moduleId) => installed.get(moduleId)?.owner });
  const installed = new Installed({ modules: new Map([[media.manifest.id, media]]), blocked: new Map(), catalog: new Set(), info: new Map(), problems: [] }, (manifest) => manifest);
  const awaiting = new Set(options.awaiting ?? []);
  const panels = { isAwaiting: (id: string) => awaiting.has(id), applyBounds: () => void calls.push("bounds") };
  const pushState = () => void calls.push("push");
  const connector = new ConnectorQuestions({
    questions,
    installed,
    grants: { grant: async (module, what) => void calls.push(`grant ${module.manifest.id} ${what?.connectors.join(",")}`) },
    changed: () => (pushState(), panels.applyBounds()),
  });
  const panel = new PanelQuestions({ questions, connectors: connector, panels, shownPanels: () => options.shown ?? [], pushState });
  return { panel, connector, calls, questions, awaiting, installed };
}

const records: InstanceRecord[] = [
  { instanceId: "one", moduleId: "wellbrained.media", owner: "abcd1234" },
  { instanceId: "two", moduleId: "wellbrained.media", owner: "abcd1234" },
  { instanceId: "notes", moduleId: "tavora.notes", owner: "official" },
];

describe("PanelQuestions", () => {
  it("lets the first panel waiting for its module's access ask and the others wait", () => {
    const { panel } = setup({ awaiting: ["one", "two"] });
    expect(records.map((record) => panel.of(record, records))).toEqual(["ask", "wait", null]);
  });

  it("shows a connector question in the module's first panel only, and grants it alone when allowed", async () => {
    const { panel, connector, calls, questions } = setup({ shown: records });
    const answer = connector.ask(asker, "media", copyLink);
    expect(calls).toEqual(["push", "bounds"]);
    expect(records.map((record) => panel.of(record, records))).toEqual(["ask", null, null]);
    expect(["one", "two", "notes"].map((id) => panel.asking(id))).toEqual([true, false, false]);

    await connector.answer(questions.peek("connector")!.id, true);
    expect(await answer).toBe(true);
    expect(calls.slice(2)).toEqual(["grant wellbrained.media media", "push", "bounds"]);
    expect(panel.asking("one")).toBe(false);
  });

  it("grants nothing the module installed now doesn't ask for on request, and ignores an answer to an older question", async () => {
    const { connector, calls, questions } = setup();
    const first = connector.ask(asker, "media", copyLink);
    const firstId = questions.peek("connector")!.id;
    const second = connector.ask(olderAsker, "discord", copyLink);
    // A newer request closes the older one as not allowed.
    expect(await first).toBe(false);
    await connector.answer(firstId, true);
    await connector.answer(questions.peek("connector")!.id, true);
    expect(await second).toBe(false);
    expect(calls.some((call) => call.startsWith("grant"))).toBe(false);
  });

  it("grants nobody when the module id changed hands while the question was open, and the asker hears no", async () => {
    const { connector, calls, questions, installed } = setup();
    const answer = connector.ask(asker, "media", copyLink);
    installed.replace({ modules: new Map([[media.manifest.id, localMedia]]), blocked: new Map(), catalog: new Set(), info: new Map(), problems: [] });
    await connector.answer(questions.peek("connector")!.id, true);
    expect(await answer).toBe(false);
    expect(calls.some((call) => call.startsWith("grant"))).toBe(false);
    expect(questions.peek("connector")).toBeUndefined();
  });

  it("ends a module's connector question as not allowed when its panels start as another owner's", async () => {
    const { panel, connector, calls, questions } = setup({ shown: records });
    const answer = connector.ask(asker, "media", copyLink);
    connector.ownerChanged("wellbrained.media");
    expect(await answer).toBe(false);
    expect(questions.peek("connector")).toBeUndefined();
    expect(panel.asking("one")).toBe(false);
    expect(calls.slice(-2)).toEqual(["push", "bounds"]);
    // Nothing left to end: the host UI isn't told again.
    const before = calls.length;
    connector.ownerChanged("wellbrained.media");
    expect(calls.length).toBe(before);
  });

  it("refuses a connector the asking module doesn't ask for on request, as without the grant, and asks nothing", () => {
    const { connector, calls, questions } = setup();
    expect(() => connector.ask(asker, "discord", copyLink)).toThrow(expect.objectContaining({ code: "PERMISSION_DENIED", message: 'overlay.copyLink needs the "overlay" permission', extra: { capability: "overlay" } }));
    expect(questions.peek("connector")).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("shows a connector question only in a panel that runs as the owner that asked, matched by owner and id", () => {
    // The first panel of the id runs as another owner (a development folder over the catalog copy): the next one asks.
    const mixed: InstanceRecord[] = [{ instanceId: "dev", moduleId: "wellbrained.media", owner: "local" }, ...records];
    const { panel, connector } = setup({ shown: mixed });
    void connector.ask(asker, "media", copyLink);
    expect(mixed.map((record) => panel.of(record, mixed))).toEqual([null, "ask", null, null]);
    expect(connector.isFor({ moduleId: "wellbrained.media", owner: "abcd1234" })).toBe(true);
    expect(connector.isFor({ moduleId: "wellbrained.media", owner: "local" })).toBe(false);
    expect(connector.isFor({ moduleId: "tavora.notes", owner: "abcd1234" })).toBe(false);
  });

  it("counts a panel with no owner noted yet as the copy installed now, so it asks only while that is the asker", () => {
    // A workspace file from before owners were noted: the panel runs as the copy installed now (host.ts settleOwner).
    const unnoted: InstanceRecord[] = [{ instanceId: "old", moduleId: "wellbrained.media" }, records[2]!];
    const { panel, connector, installed } = setup({ shown: unnoted });
    void connector.ask(asker, "media", copyLink);
    expect(unnoted.map((record) => panel.of(record, unnoted))).toEqual(["ask", null]);
    expect(panel.asking("old")).toBe(true);
    // Another owner's copy took the id over: the panel would run as that one, so it is not asked there.
    installed.replace({ modules: new Map([[media.manifest.id, localMedia]]), blocked: new Map(), catalog: new Set(), info: new Map(), problems: [] });
    expect(unnoted.map((record) => panel.of(record, unnoted))).toEqual([null, null]);
    expect(panel.asking("old")).toBe(false);
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
