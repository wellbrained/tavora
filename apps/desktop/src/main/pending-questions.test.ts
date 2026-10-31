import { describe, expect, it } from "vitest";
import { PendingQuestions } from "./pending-questions";

const content = { id: "c1", title: "Build" } as never;
const navigation = { workspaceId: "w1", moduleId: "m", panelType: "t", panelName: "Viewer", content };
const dialog = { module: {} as never, size: {} as never, until: 0, byClick: true };
const consent = { kind: "consent", name: "Ann" } as const;
const connector = { moduleId: "m", connector: "stream-overlay" } as const;

describe("ask, answer and cancel", () => {
  it("resolves the asker with the answer and clears the slice", async () => {
    const questions = new PendingQuestions();
    const { id, answer } = questions.ask("link", { workspace: "w1" }, { url: "https://example.com" });
    expect(questions.snapshot().pendingLink).toBe("https://example.com");
    expect(questions.answer(id, "system")).toBe(true);
    await expect(answer).resolves.toBe("system");
    expect(questions.snapshot().pendingLink).toBeNull();
  });

  it("ignores an answer for an id that is not open (or already answered)", async () => {
    const questions = new PendingQuestions();
    const { id, answer } = questions.ask("connector", { module: "m" }, connector);
    expect(questions.answer(id + 99, true)).toBe(false);
    expect(questions.answer(id, true)).toBe(true);
    expect(questions.answer(id, false)).toBe(false);
    await expect(answer).resolves.toBe(true);
  });

  it("takes the question away at once when the answer is still being worked out", async () => {
    const questions = new PendingQuestions();
    const { id, answer } = questions.ask("connector", { module: "m" }, connector);
    let finish!: (granted: boolean) => void;
    questions.answer(id, new Promise<boolean>((resolve) => (finish = resolve)));
    expect(questions.peek("connector")).toBeUndefined();
    finish(true);
    await expect(answer).resolves.toBe(true);
  });

  it("gives every question its own id", () => {
    const questions = new PendingQuestions();
    const ids = [
      questions.ask("link", { workspace: "w" }, { url: "a" }).id,
      questions.ask("connector", { module: "m" }, connector).id,
      questions.ask("leaderboard", { panel: "p" }, { moduleId: "m", question: consent }).id,
      questions.ask("menu", { panel: "p" }, { choices: new Set() }).id,
      questions.ask("gameSwitch", { workspace: "g" }, { gameId: "g" }).id,
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("cancels one question by id with the no-answer of its kind", async () => {
    const questions = new PendingQuestions();
    const link = questions.ask("link", { workspace: "w" }, { url: "a" });
    const menu = questions.ask("menu", { panel: "p" }, { choices: new Set(["x"]) });
    const board = questions.ask("leaderboard", { panel: "p" }, { moduleId: "m", question: consent });
    expect(questions.cancel(link.id)).toBe(1);
    expect(questions.cancel(menu.id)).toBe(1);
    expect(questions.cancel(board.id)).toBe(1);
    expect(questions.cancel(board.id)).toBe(0);
    await expect(link.answer).resolves.toBe("cancel");
    await expect(menu.answer).resolves.toBeNull();
    await expect(board.answer).resolves.toBe(false);
  });
});

describe("scopes", () => {
  function rig() {
    const questions = new PendingQuestions();
    return {
      questions,
      onPanel: questions.ask("leaderboard", { panel: "p1" }, { moduleId: "m", question: consent }),
      menuOnPanel: questions.ask("menu", { panel: "p1" }, { choices: new Set() }),
      otherPanel: questions.ask("dialog", { panel: "p2" }, dialog),
      inWorkspace: questions.ask("link", { workspace: "w1" }, { url: "https://example.com" }),
      otherWorkspace: questions.ask("gameSwitch", { workspace: "w2" }, { gameId: "w2" }),
      onModule: questions.ask("connector", { module: "m" }, connector),
    };
  }
  const settled = async (...asks: { answer: Promise<unknown> }[]) => {
    const open = Symbol("open");
    return Promise.all(asks.map((ask) => Promise.race([ask.answer, Promise.resolve(open)]).then((value) => value !== open)));
  };

  it("cancelling a panel leaves the other panel, workspaces and the module alone", async () => {
    const r = rig();
    expect(r.questions.cancel({ panel: "p1" })).toBe(2);
    expect(await settled(r.onPanel, r.menuOnPanel, r.otherPanel, r.inWorkspace, r.otherWorkspace, r.onModule)).toEqual([true, true, false, false, false, false]);
    await expect(r.onPanel.answer).resolves.toBe(false);
    await expect(r.menuOnPanel.answer).resolves.toBeNull();
  });

  it("cancelling a workspace leaves other workspaces, panels and the module alone", async () => {
    const r = rig();
    expect(r.questions.cancel({ workspace: "w1" })).toBe(1);
    expect(await settled(r.onPanel, r.otherPanel, r.inWorkspace, r.otherWorkspace, r.onModule)).toEqual([false, false, true, false, false]);
    await expect(r.inWorkspace.answer).resolves.toBe("cancel");
    expect(r.questions.snapshot().pendingLink).toBeNull();
    expect(r.questions.snapshot().pendingGameSwitch).toBe("w2");
  });

  it("cancelling a module leaves panels, workspaces and other modules alone", async () => {
    const r = rig();
    expect(r.questions.cancel({ module: "other" })).toBe(0);
    expect(r.questions.cancel({ module: "m" })).toBe(1);
    expect(await settled(r.onPanel, r.inWorkspace, r.otherWorkspace, r.onModule)).toEqual([false, false, false, true]);
    await expect(r.onModule.answer).resolves.toBe(false);
  });

  it("can limit a cancel to one kind", async () => {
    const r = rig();
    expect(r.questions.cancel({ panel: "p1" }, "menu")).toBe(1);
    expect(await settled(r.onPanel, r.menuOnPanel)).toEqual([false, true]);
    expect(r.questions.cancelKind("leaderboard")).toBe(1);
    expect(r.questions.peek("leaderboard")).toBeUndefined();
  });

  it("cancelling an empty scope does nothing", () => {
    expect(new PendingQuestions().cancel({ panel: "none" })).toBe(0);
  });
});

describe("a newer question of the same kind", () => {
  it("replaces the older one, which counts as not answered", async () => {
    const questions = new PendingQuestions();
    const first = questions.ask("leaderboard", { panel: "p1" }, { moduleId: "m", question: consent });
    const second = questions.ask("leaderboard", { panel: "p2" }, { moduleId: "m", question: { kind: "sign-in" } });
    await expect(first.answer).resolves.toBe(false);
    expect(questions.peek("leaderboard")?.id).toBe(second.id);
    expect(questions.snapshot().pendingLeaderboard).toEqual({ id: second.id, instanceId: "p2", moduleId: "m", kind: "sign-in" });
  });

  it("keeps different kinds side by side", () => {
    const questions = new PendingQuestions();
    questions.ask("connector", { module: "m" }, connector);
    questions.ask("leaderboard", { panel: "p" }, { moduleId: "m", question: consent });
    questions.ask("link", { workspace: "w" }, { url: "a" });
    const view = questions.snapshot();
    expect(view.pendingConnector).not.toBeNull();
    expect(view.pendingLeaderboard).not.toBeNull();
    expect(view.pendingLink).toBe("a");
  });
});

describe("queued kinds", () => {
  const queued = () => new PendingQuestions({ queued: ["connector"] });
  const ask = (questions: PendingQuestions, moduleId: string) => questions.ask("connector", { module: moduleId }, { moduleId, connector: "stream-overlay" });

  it("makes the second ask wait until the first is answered", async () => {
    const questions = queued();
    const first = ask(questions, "a");
    const second = ask(questions, "b");
    expect(questions.snapshot().pendingConnector?.moduleId).toBe("a");
    questions.answer(first.id, true);
    await expect(first.answer).resolves.toBe(true);
    expect(questions.snapshot().pendingConnector).toEqual({ id: second.id, moduleId: "b", connectors: ["stream-overlay"] });
    questions.answer(second.id, false);
    await expect(second.answer).resolves.toBe(false);
    expect(questions.snapshot().pendingConnector).toBeNull();
  });

  it("moves on when the first one is cancelled, and cancels waiting ones by scope too", async () => {
    const questions = queued();
    const first = ask(questions, "a");
    const second = questions.ask("connector", { workspace: "w" }, { moduleId: "b", connector: "stream-overlay" });
    const third = ask(questions, "c");
    questions.cancel(first.id);
    expect(questions.peek("connector")?.id).toBe(second.id);
    questions.cancel({ workspace: "w" });
    await expect(second.answer).resolves.toBe(false);
    expect(questions.peek("connector")?.id).toBe(third.id);
  });

  it("cancels a waiting one by id without touching the shown one", async () => {
    const questions = queued();
    const first = ask(questions, "a");
    const second = ask(questions, "b");
    questions.cancel(second.id);
    await expect(second.answer).resolves.toBe(false);
    expect(questions.peek("connector")?.id).toBe(first.id);
  });
});

describe("snapshot", () => {
  it("is empty without questions", () => {
    expect(new PendingQuestions().snapshot()).toEqual({ pendingLink: null, pendingNavigation: null, pendingGameSwitch: null, pendingConnector: null, pendingLeaderboard: null });
  });

  it("has the shape of the host view fields, per kind", () => {
    const questions = new PendingQuestions();
    questions.ask("link", { workspace: "w1" }, { url: "https://example.com" });
    questions.ask("navigation", { workspace: "w1" }, navigation);
    questions.ask("gameSwitch", { workspace: "g1" }, { gameId: "g1" });
    const connectorAsk = questions.ask("connector", { module: "m" }, connector);
    const board = questions.ask("leaderboard", { panel: "p1" }, { moduleId: "m", question: consent });
    expect(questions.snapshot()).toEqual({
      pendingLink: "https://example.com",
      pendingNavigation: { panel: "Viewer", content: "Build" },
      pendingGameSwitch: "g1",
      pendingConnector: { id: connectorAsk.id, moduleId: "m", connectors: ["stream-overlay"] },
      pendingLeaderboard: { id: board.id, instanceId: "p1", moduleId: "m", kind: "consent", name: "Ann" },
    });
  });

  it("leaves menus and waiting dialogs out: the host UI gets them another way", () => {
    const questions = new PendingQuestions();
    questions.ask("menu", { panel: "p" }, { choices: new Set(["a"]) });
    questions.ask("dialog", { panel: "p" }, dialog);
    expect(questions.snapshot()).toEqual(new PendingQuestions().snapshot());
    expect(questions.peek("menu")?.payload.choices.has("a")).toBe(true);
    expect(questions.peek("dialog")?.scope).toEqual({ panel: "p" });
  });
});

describe("a panel closing while its question is open", () => {
  it("says no to its leaderboard question, as the host did before", async () => {
    const questions = new PendingQuestions();
    const board = questions.ask("leaderboard", { panel: "p1" }, { moduleId: "m", question: consent });
    questions.cancel({ panel: "p1" });
    await expect(board.answer).resolves.toBe(false);
    expect(questions.snapshot().pendingLeaderboard).toBeNull();
    expect(questions.answer(board.id, true)).toBe(false);
  });

  it("drops the panel's menu and waiting dialog too", async () => {
    const questions = new PendingQuestions();
    const menu = questions.ask("menu", { panel: "p1" }, { choices: new Set(["a"]) });
    const waiting = questions.ask("dialog", { panel: "p1" }, dialog);
    questions.cancel({ panel: "p1" });
    await expect(menu.answer).resolves.toBeNull();
    await expect(waiting.answer).resolves.toBe(false);
    expect(questions.peek("dialog")).toBeUndefined();
  });
});
