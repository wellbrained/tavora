// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import { Skeleton, SKELETON_DELAY, SKELETON_REVEAL } from ".";

// The made-up content must never be real to the user: no focus, no clicks, nothing read out, from the moment it is laid
// out (waiting) until the real content arrives (leaving and after). The bars themselves are CSS (skeleton.css).

let app: App | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function mount() {
  const loading = ref(true);
  const clicked = vi.fn();
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp(defineComponent({ render: () => h(Skeleton, { loading: loading.value, class: "box" }, () => h("button", { type: "button", onClick: clicked }, "Install")) }));
  app.mount(root);
  return { loading, clicked, skeleton: () => root.querySelector("[data-slot=skeleton]") as HTMLElement, button: () => root.querySelector("button") as HTMLElement };
}

const isPlaceholder = (element: HTMLElement) => element.hasAttribute("inert") && element.getAttribute("aria-hidden") === "true";

describe("Skeleton", () => {
  it("makes the placeholder inert and hidden from screen readers while it waits and while it shows", async () => {
    const { skeleton, button } = mount();
    expect(skeleton().dataset.skeleton).toBe("waiting");
    expect(isPlaceholder(skeleton())).toBe(true);
    // A control in it is inside the inert, hidden wrapper: the browser takes it out of the tab order and the tree.
    expect(skeleton().contains(button())).toBe(true);
    vi.advanceTimersByTime(SKELETON_DELAY);
    await nextTick();
    expect(skeleton().dataset.skeleton).toBe("on");
    expect(isPlaceholder(skeleton())).toBe(true);
  });

  it("gives the content back as soon as it arrives, fading over the bars", async () => {
    const { skeleton, loading } = mount();
    vi.advanceTimersByTime(SKELETON_DELAY);
    await nextTick();
    loading.value = false;
    await nextTick();
    expect(skeleton().dataset.skeleton).toBe("leaving");
    expect(skeleton().hasAttribute("inert")).toBe(false);
    expect(skeleton().hasAttribute("aria-hidden")).toBe(false);
    vi.advanceTimersByTime(SKELETON_REVEAL);
    await nextTick();
    expect(skeleton().hasAttribute("data-skeleton")).toBe(false);
  });

  it("a load that ends before the delay leaves nothing behind", async () => {
    const { skeleton, loading } = mount();
    loading.value = false;
    await nextTick();
    expect(skeleton().hasAttribute("data-skeleton")).toBe(false);
    expect(skeleton().hasAttribute("inert")).toBe(false);
  });

  it("keeps its own classes", () => {
    expect(mount().skeleton().classList.contains("box")).toBe(true);
  });
});
