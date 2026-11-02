import { describe, expect, it, vi } from "vitest";
import { createOptimistic, useOptimistic, useOptimisticKeyed } from "./optimistic";
import { ref } from "vue";

/** A save the test finishes by hand, so it decides the order things happen in. */
function manualSaves() {
  const calls: { value: number; ok: () => void; fail: (reason?: unknown) => void }[] = [];
  const save = (value: number) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ value, ok: resolve, fail: (reason) => reject(reason ?? new Error("offline")) });
    });
  return { calls, save };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(initial = 1) {
  const saved = ref(initial);
  const shown = ref(initial);
  const { calls, save } = manualSaves();
  const failed = vi.fn();
  const slot = createOptimistic<number>({
    read: () => saved.value,
    show: (value) => (shown.value = value),
    save: async (value) => {
      await save(value);
      saved.value = value;
    },
    failed,
    settled: () => (shown.value = saved.value),
  });
  return { saved, shown, calls, slot, failed };
}

describe("createOptimistic", () => {
  it("shows the change before the save has answered, and keeps it once saved", async () => {
    const { shown, saved, calls, slot, failed } = setup();
    const done = slot.set(2);
    expect(shown.value).toBe(2);
    expect(saved.value).toBe(1);
    expect(slot.waiting).toBe(true);
    await tick();
    calls[0]!.ok();
    expect(await done).toBe(true);
    expect(shown.value).toBe(2);
    expect(saved.value).toBe(2);
    expect(slot.waiting).toBe(false);
    expect(failed).not.toHaveBeenCalled();
  });

  it("puts the old value back and says so once when the save fails", async () => {
    const { shown, calls, slot, failed } = setup();
    const done = slot.set(2);
    await tick();
    const reason = new Error("offline");
    calls[0]!.fail(reason);
    expect(await done).toBe(false);
    expect(shown.value).toBe(1);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith(reason);
    expect(slot.waiting).toBe(false);
  });

  it("two quick changes: the later one wins and only it is saved after the first", async () => {
    const { shown, saved, calls, slot } = setup();
    const first = slot.set(2);
    await tick();
    const second = slot.set(3);
    const third = slot.set(4);
    expect(shown.value).toBe(4);
    // The first is still saving; 3 was replaced by 4 before it ever started.
    expect(await second).toBe(false);
    calls[0]!.ok();
    expect(await first).toBe(true);
    await tick();
    expect(calls.map((call) => call.value)).toEqual([2, 4]);
    calls[1]!.ok();
    expect(await third).toBe(true);
    expect(saved.value).toBe(4);
    expect(shown.value).toBe(4);
  });

  it("a failed earlier save does not overwrite a newer value", async () => {
    const { shown, saved, calls, slot, failed } = setup();
    const first = slot.set(2);
    await tick();
    const second = slot.set(3);
    calls[0]!.fail();
    expect(await first).toBe(false);
    // Nothing is put back and nothing is said: the newer change is still on its way.
    expect(shown.value).toBe(3);
    expect(failed).not.toHaveBeenCalled();
    await tick();
    expect(calls.map((call) => call.value)).toEqual([2, 3]);
    calls[1]!.ok();
    expect(await second).toBe(true);
    expect(saved.value).toBe(3);
    expect(shown.value).toBe(3);
    expect(failed).not.toHaveBeenCalled();
  });

  it("when the newer change fails too, it goes back to the last value that was really saved", async () => {
    const { shown, saved, calls, slot, failed } = setup(1);
    const first = slot.set(2);
    await tick();
    calls[0]!.ok();
    await first;
    expect(saved.value).toBe(2);

    const second = slot.set(3);
    await tick();
    const third = slot.set(4);
    calls[1]!.fail();
    await second;
    await tick();
    expect(shown.value).toBe(4);
    calls[2]!.fail();
    await third;
    // Back to 2 (saved), not to 3 (which never was).
    expect(shown.value).toBe(2);
    expect(saved.value).toBe(2);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("a failed change can be tried again", async () => {
    const { shown, saved, calls, slot } = setup();
    const first = slot.set(2);
    await tick();
    calls[0]!.fail();
    await first;
    expect(shown.value).toBe(1);
    const again = slot.set(2);
    await tick();
    calls[1]!.ok();
    expect(await again).toBe(true);
    expect(saved.value).toBe(2);
  });

  it("reads the saved value again for each change that starts while idle", async () => {
    const { saved, shown, calls, slot } = setup();
    const first = slot.set(2);
    await tick();
    calls[0]!.ok();
    await first;
    // Something else changed the saved value in between (another window, a refresh).
    saved.value = 10;
    const second = slot.set(11);
    await tick();
    calls[1]!.fail();
    await second;
    expect(shown.value).toBe(10);
  });
});

describe("useOptimistic", () => {
  it("shows the new value while saving and the source's after", async () => {
    const source = ref(false);
    const { calls, save } = manualSaves();
    const failed = vi.fn();
    const flag = useOptimistic(
      () => source.value,
      async (value) => {
        await save(value ? 1 : 0);
        source.value = value;
      },
      failed,
    );
    expect(flag.value.value).toBe(false);
    const done = flag.set(true);
    expect(flag.value.value).toBe(true);
    expect(flag.waiting.value).toBe(true);
    await tick();
    calls[0]!.ok();
    await done;
    expect(flag.value.value).toBe(true);
    expect(flag.waiting.value).toBe(false);
  });

  it("goes back to the source when saving fails", async () => {
    const source = ref("a");
    const { calls, save } = manualSaves();
    const failed = vi.fn();
    const name = useOptimistic(
      () => source.value,
      async (value) => {
        await save(value.length);
      },
      failed,
    );
    const done = name.set("bb");
    expect(name.value.value).toBe("bb");
    await tick();
    calls[0]!.fail();
    await done;
    expect(name.value.value).toBe("a");
    expect(failed).toHaveBeenCalledTimes(1);
  });
});

describe("useOptimisticKeyed", () => {
  it("races per key: a failing key goes back while the other stays", async () => {
    const names = ref<Record<string, string>>({ a: "one", b: "two" });
    const saves: { key: string; ok: () => void; fail: () => void }[] = [];
    const failed = vi.fn();
    const list = useOptimisticKeyed<string, string>(
      (key) => names.value[key]!,
      (key, value) =>
        new Promise<void>((resolve, reject) => {
          saves.push({
            key,
            ok: () => {
              names.value = { ...names.value, [key]: value };
              resolve();
            },
            fail: () => reject(new Error("offline")),
          });
        }),
      failed,
    );
    const a = list.set("a", "uno");
    const b = list.set("b", "dos");
    expect(list.value("a")).toBe("uno");
    expect(list.value("b")).toBe("dos");
    await tick();
    saves.find((save) => save.key === "a")!.fail();
    saves.find((save) => save.key === "b")!.ok();
    expect(await a).toBe(false);
    expect(await b).toBe(true);
    expect(list.value("a")).toBe("one");
    expect(list.value("b")).toBe("dos");
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0]![1]).toBe("a");
  });
});
