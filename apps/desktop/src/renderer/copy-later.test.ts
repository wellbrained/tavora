// @vitest-environment jsdom
// Later on a cloud copy question puts off that question only: a new one after it is asked again.
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { CloudCopyView } from "../shared/host-api";

vi.hoisted(() => {
  // Every listener is taken and never called, every other call answers nothing: the test sets the state itself.
  (window as unknown as { tavoraHost: unknown }).tavoraHost = new Proxy({} as Record<string, unknown>, {
    get: (_, key) => (typeof key === "string" && key.startsWith("on") ? () => () => undefined : () => Promise.resolve(null)),
  });
  document.elementsFromPoint ??= () => [];
  if (!("PerformanceObserver" in globalThis)) (globalThis as Record<string, unknown>).PerformanceObserver = class { observe() {} disconnect() {} };
});

import { cloudCopy, copyLater, copyQuestion } from "./host";

const view = (asks: Partial<CloudCopyView>) => ({ closing: false, conflict: false, restartToTake: false, ...asks }) as CloudCopyView;

afterEach(() => {
  cloudCopy.value = null;
  copyLater.value = null;
});

describe("Later on a cloud copy question", () => {
  it("asks again about a conflict that comes after the one put off", async () => {
    cloudCopy.value = view({ conflict: true });
    expect(copyQuestion.value).toBe("conflict");
    copyLater.value = "conflict";
    expect(copyQuestion.value).toBeNull();
    // Settled on another PC, then a new one.
    cloudCopy.value = view({});
    await nextTick();
    cloudCopy.value = view({ conflict: true });
    await nextTick();
    expect(copyQuestion.value).toBe("conflict");
  });

  it("keeps it put off while it stays", async () => {
    cloudCopy.value = view({ restartToTake: true });
    copyLater.value = "newer";
    cloudCopy.value = view({ restartToTake: true });
    await nextTick();
    expect(copyQuestion.value).toBeNull();
  });
});
