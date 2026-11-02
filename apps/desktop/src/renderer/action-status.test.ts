import { effectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DONE_FOR_MS, useActionStatus } from "./action-status";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const make = () => effectScope().run(() => useActionStatus())!;

describe("useActionStatus", () => {
  it("is busy while the work runs, then done for a moment, then idle", async () => {
    const actions = make();
    let finish!: (ok: boolean) => void;
    const run = actions.run("a", () => new Promise<boolean>((resolve) => (finish = resolve)));
    expect(actions.statusOf("a")).toBe("busy");
    expect(actions.working.value).toBe(true);
    finish(true);
    await expect(run).resolves.toBe(true);
    expect(actions.statusOf("a")).toBe("done");
    expect(actions.working.value).toBe(false);
    expect(actions.active.value).toBe(true);
    vi.advanceTimersByTime(DONE_FOR_MS);
    expect(actions.statusOf("a")).toBe("idle");
    expect(actions.active.value).toBe(false);
  });

  it("goes straight back to idle when the work failed or threw", async () => {
    const actions = make();
    await expect(actions.run("a", async () => false)).resolves.toBe(false);
    expect(actions.statusOf("a")).toBe("idle");
    await expect(actions.run("a", async () => { throw new Error("no"); })).rejects.toThrow();
    expect(actions.statusOf("a")).toBe("idle");
  });

  it("does not let the last run's done timer end a run that started again", async () => {
    const actions = make();
    await actions.run("a", async () => true);
    vi.advanceTimersByTime(DONE_FOR_MS - 100);
    let finish!: (ok: boolean) => void;
    const again = actions.run("a", () => new Promise<boolean>((resolve) => (finish = resolve)));
    vi.advanceTimersByTime(500);
    expect(actions.statusOf("a")).toBe("busy");
    finish(true);
    await again;
    expect(actions.statusOf("a")).toBe("done");
    vi.advanceTimersByTime(DONE_FOR_MS);
    expect(actions.statusOf("a")).toBe("idle");
  });
});
