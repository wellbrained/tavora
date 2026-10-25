import { beforeEach, describe, expect, it } from "vitest";
import { dismissToast, toast, toasts } from "./toast";

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
});
