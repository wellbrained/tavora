import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { placeholderText, SKELETON_DELAY, SKELETON_REVEAL, useSkeleton } from "./use-skeleton";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(initial: boolean) {
  const loading = ref(initial);
  const scope = effectScope();
  const state = scope.run(() => useSkeleton(loading))!;
  return { loading, state, scope };
}

describe("useSkeleton", () => {
  it("is idle when nothing loads", () => {
    expect(setup(false).state.value).toBe("idle");
  });

  it("holds the placeholder back for the delay, then shows it", () => {
    const { state } = setup(true);
    expect(state.value).toBe("waiting");
    vi.advanceTimersByTime(SKELETON_DELAY - 1);
    expect(state.value).toBe("waiting");
    vi.advanceTimersByTime(1);
    expect(state.value).toBe("on");
  });

  it("a load that ends within the delay never shows the placeholder", async () => {
    const { loading, state } = setup(true);
    vi.advanceTimersByTime(SKELETON_DELAY - 50);
    loading.value = false;
    await nextTick();
    expect(state.value).toBe("idle");
    vi.advanceTimersByTime(1000);
    expect(state.value).toBe("idle");
  });

  it("lets the content arrive over a shown placeholder, then goes idle", async () => {
    const { loading, state } = setup(true);
    vi.advanceTimersByTime(SKELETON_DELAY);
    loading.value = false;
    await nextTick();
    expect(state.value).toBe("leaving");
    vi.advanceTimersByTime(SKELETON_REVEAL);
    expect(state.value).toBe("idle");
  });

  it("starts over when it loads again", async () => {
    const { loading, state } = setup(true);
    vi.advanceTimersByTime(SKELETON_DELAY);
    loading.value = false;
    await nextTick();
    loading.value = true;
    await nextTick();
    expect(state.value).toBe("waiting");
    vi.advanceTimersByTime(SKELETON_REVEAL + SKELETON_DELAY);
    expect(state.value).toBe("on");
  });

  it("stops its timers with the scope", () => {
    const { state, scope } = setup(true);
    scope.stop();
    vi.advanceTimersByTime(SKELETON_DELAY * 2);
    expect(state.value).toBe("waiting");
  });
});

describe("placeholderText", () => {
  it("is about as long as asked, in words", () => {
    for (const length of [1, 10, 90, 240]) {
      const text = placeholderText(length);
      expect(text.length).toBeLessThanOrEqual(length);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/\s$/);
    }
    expect(placeholderText(90).split(" ").length).toBeGreaterThan(5);
  });
});
