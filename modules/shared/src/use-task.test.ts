import { describe, expect, it } from "vitest";
import { useTask } from "./use-task";

/** A promise the test settles by hand. */
function later<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("useTask", () => {
  it("is idle, running while the work goes, then idle with its result", async () => {
    const task = useTask();
    expect(task.state.value).toEqual({ status: "idle" });
    const work = later<number>();
    const run = task.run(() => work.promise);
    expect(task.state.value.status).toBe("running");
    expect(task.busy.value).toBe(true);
    work.resolve(7);
    await expect(run).resolves.toBe(7);
    expect(task.state.value).toEqual({ status: "idle" });
    expect(task.busy.value).toBe(false);
  });

  it("never stays running when the work throws", async () => {
    const task = useTask();
    await expect(task.run(() => Promise.reject(new Error("offline")))).resolves.toBeUndefined();
    expect(task.state.value).toEqual({ status: "failed", error: "offline" });
    expect(task.error.value).toBe("offline");
  });

  it("words a throw with describe", async () => {
    const task = useTask({ describe: () => "Something went wrong." });
    await task.run(() => Promise.reject(new Error("ECONNRESET")));
    expect(task.error.value).toBe("Something went wrong.");
  });

  it("ignores a second run while one is going (a double click)", async () => {
    const task = useTask();
    const work = later<string>();
    let calls = 0;
    const first = task.run(() => {
      calls++;
      return work.promise;
    });
    await expect(
      task.run(() => {
        calls++;
        return Promise.resolve("second");
      }),
    ).resolves.toBeUndefined();
    work.resolve("first");
    await expect(first).resolves.toBe("first");
    expect(calls).toBe(1);
  });

  it("latest: a newer run wins, and the older answer lands nowhere", async () => {
    const task = useTask({ mode: "latest" });
    const old = later<string>();
    const fresh = later<string>();
    const first = task.run(() => old.promise);
    const second = task.run(() => fresh.promise);
    fresh.resolve("new");
    await expect(second).resolves.toBe("new");
    old.resolve("old");
    await expect(first).resolves.toBeUndefined();
    expect(task.state.value).toEqual({ status: "idle" });
  });

  it("latest: an older run that fails does not mark the newer one failed", async () => {
    const task = useTask({ mode: "latest" });
    const old = later<string>();
    const fresh = later<string>();
    void task.run(() => old.promise);
    const second = task.run(() => fresh.promise);
    old.reject(new Error("late"));
    await Promise.resolve();
    expect(task.state.value.status).toBe("running");
    fresh.resolve("ok");
    await second;
    expect(task.state.value).toEqual({ status: "idle" });
  });

  it("fail shows an answer that did not succeed; the next run clears it", async () => {
    const task = useTask();
    task.fail("Can't find this folder");
    expect(task.error.value).toBe("Can't find this folder");
    await task.run(() => Promise.resolve(1));
    expect(task.error.value).toBeNull();
  });

  it("reset drops a run still going", async () => {
    const task = useTask();
    const work = later<number>();
    const run = task.run(() => work.promise);
    task.reset();
    expect(task.state.value).toEqual({ status: "idle" });
    work.resolve(1);
    await expect(run).resolves.toBeUndefined();
    expect(task.state.value).toEqual({ status: "idle" });
  });
});
