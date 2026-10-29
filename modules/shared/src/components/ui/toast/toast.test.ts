import { beforeEach, describe, expect, it } from "vitest";
import { dismissToast, setToastPosition, toast, toastDuration, toastPosition, toasts, TOAST_DURATION } from "./toast";

describe("toast", () => {
  beforeEach(() => {
    toasts.value = [];
  });

  it("adds a toast and hands back a way to dismiss it", () => {
    const { dismiss } = toast({ title: "Saved" });
    expect(toasts.value.map((item) => item.title)).toEqual(["Saved"]);
    dismiss();
    expect(toasts.value).toEqual([]);
  });

  it("returns the id and keeps duration and test ids", () => {
    const { id } = toast({ title: "a", duration: Infinity, testid: "t", actionTestid: "x" });
    expect(toasts.value[0]).toMatchObject({ id, duration: Infinity, testid: "t", actionTestid: "x" });
  });

  it("keeps the newest three", () => {
    for (const title of ["a", "b", "c", "d"]) toast({ title });
    expect(toasts.value.map((item) => item.title)).toEqual(["b", "c", "d"]);
  });

  it("ignores an id that is already gone", () => {
    toast({ title: "a" });
    dismissToast(999);
    expect(toasts.value).toHaveLength(1);
  });

  it("has a call for each kind", () => {
    toast.success("Saved");
    toast.warning("Almost full", { duration: 2000 });
    expect(toasts.value.map((item) => [item.variant, item.title, item.duration])).toEqual([
      ["success", "Saved", undefined],
      ["warning", "Almost full", 2000],
    ]);
  });

  it("keeps errors, warnings and loading until dismissed, unless told otherwise", () => {
    expect(toastDuration({ title: "a" })).toBe(TOAST_DURATION);
    expect(toastDuration({ title: "a", variant: "success" })).toBe(TOAST_DURATION);
    for (const variant of ["error", "warning", "loading"] as const) expect(toastDuration({ title: "a", variant })).toBe(Infinity);
    expect(toastDuration({ title: "a", variant: "error", duration: 3000 })).toBe(3000);
  });

  it("changes a toast in place and counts the change", () => {
    const handle = toast.loading("Saving…");
    handle.update({ variant: "success", title: "Saved" });
    expect(toasts.value).toEqual([expect.objectContaining({ id: handle.id, variant: "success", title: "Saved", revision: 1 })]);
  });

  it("turns a promise's toast into done or failed", async () => {
    await toast.promise(Promise.resolve(3), { loading: "Saving…", success: (n) => `Saved ${n}`, error: "Can't save" });
    await Promise.resolve();
    expect(toasts.value.map((item) => [item.variant, item.title])).toEqual([["success", "Saved 3"]]);

    toasts.value = [];
    await expect(toast.promise(Promise.reject(new Error("no")), { loading: "Saving…", success: "Saved", error: "Can't save" })).rejects.toThrow("no");
    await Promise.resolve();
    expect(toasts.value.map((item) => [item.variant, item.title])).toEqual([["error", "Can't save"]]);
  });
});

describe("toast position", () => {
  it("takes a known position and falls back to bottom center", () => {
    setToastPosition("top-center");
    expect(toastPosition.value).toBe("top-center");
    setToastPosition(undefined);
    expect(toastPosition.value).toBe("bottom-center");
    setToastPosition("left");
    expect(toastPosition.value).toBe("bottom-center");
  });
});
