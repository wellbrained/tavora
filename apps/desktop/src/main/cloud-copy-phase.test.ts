import { describe, expect, it } from "vitest";
import { activityView, ask, begin, closeShown, closeView, IDLE, progressed, questionView, type CopyClose, type CopyQuestion } from "./cloud-copy-phase";

describe("what the cloud copy is doing", () => {
  it("goes start → progress → done while uploading, and Settings sees each", () => {
    let activity = begin("uploading");
    expect(activityView(activity)).toEqual({ busy: "uploading", progress: null });
    activity = progressed(activity, { done: 1, total: 4 });
    activity = progressed(activity, { done: 4, total: 4 });
    expect(activityView(activity)).toEqual({ busy: "uploading", progress: { done: 4, total: 4 } });
    activity = IDLE;
    expect(activityView(activity)).toEqual({ busy: null, progress: null });
  });

  it("has progress only while uploading: a late report after the upload ended changes nothing", () => {
    expect(progressed(IDLE, { done: 1, total: 2 })).toBe(IDLE);
    const checking = begin("checking");
    expect(progressed(checking, { done: 1, total: 2 })).toBe(checking);
    expect(activityView(begin("downloading"))).toEqual({ busy: "downloading", progress: null });
    expect(activityView(checking)).toEqual({ busy: "checking", progress: null });
  });
});

describe("what the cloud copy waits on the user for", () => {
  it("asks one thing at a time, and Settings sees exactly that one", () => {
    const flags = (question: CopyQuestion) => questionView(question);
    expect(flags(null)).toEqual({ askKey: false, conflict: false, restartToTake: false });
    expect(flags("key")).toEqual({ askKey: true, conflict: false, restartToTake: false });
    expect(flags("conflict")).toEqual({ askKey: false, conflict: true, restartToTake: false });
    expect(flags("restart")).toEqual({ askKey: false, conflict: false, restartToTake: true });
  });

  it("keeps the keep-which-side question over a restart, which would take a copy the user hasn't chosen", () => {
    expect(ask("conflict", "restart")).toBe("conflict");
    expect(ask("restart", "conflict")).toBe("conflict");
    expect(ask(null, "restart")).toBe("restart");
    expect(ask("key", "conflict")).toBe("conflict");
  });
});

describe("the window's close while the last upload runs", () => {
  it("shows that it waits only while it still waits", () => {
    const holding: CopyClose = { phase: "holding", shown: false };
    expect(closeView(holding)).toEqual({ closing: false });
    expect(closeView(closeShown(holding))).toEqual({ closing: true });
    // The close went on (the upload ended, or the user closed anyway): a late timer shows nothing.
    const closed: CopyClose = { phase: "closed" };
    expect(closeShown(closed)).toBe(closed);
    expect(closeView(closeShown(closed))).toEqual({ closing: false });
    expect(closeView(closeShown({ phase: "open" }))).toEqual({ closing: false });
  });
});
