// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import { FadeImage } from ".";
import { forgetSeen, markSeen, wasSeen } from "./seen";

// The fade itself is CSS. What matters: a picture that has been shown before is there at once (no muted box, no fade),
// a new one starts hidden over a muted box, and one that fails shows the fallback.

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
  forgetSeen();
});

function mount(src: string | null) {
  const current = ref(src);
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp(defineComponent({ render: () => h(FadeImage, { src: current.value, class: "size-8", "data-testid": "pic" }, { fallback: () => h("i", { "data-testid": "fallback" }) }) }));
  app.mount(root);
  return { current, box: () => root.querySelector("[data-slot=fade-image]") as HTMLElement, img: () => root.querySelector("img") as HTMLImageElement | null, root };
}

describe("FadeImage", () => {
  it("starts a new picture hidden over a muted box, and shows it when it has loaded", async () => {
    const { img, box } = mount("one.png");
    expect(box().classList.contains("bg-muted/60")).toBe(true);
    expect(img()!.classList.contains("opacity-100")).toBe(false);
    img()!.dispatchEvent(new Event("load"));
    await nextTick();
    expect(img()!.classList.contains("opacity-100")).toBe(true);
    expect(wasSeen("one.png")).toBe(true);
  });

  it("shows a picture that was shown before at once", () => {
    markSeen("two.png");
    const { img } = mount("two.png");
    expect(img()!.classList.contains("opacity-100")).toBe(true);
  });

  it("switching to a picture seen before does not fade, to a new one does", async () => {
    markSeen("b.png");
    const { img, current } = mount("a.png");
    img()!.dispatchEvent(new Event("load"));
    await nextTick();
    current.value = "b.png";
    await nextTick();
    expect(img()!.classList.contains("opacity-100")).toBe(true);
    current.value = "c.png";
    await nextTick();
    expect(img()!.classList.contains("opacity-100")).toBe(false);
  });

  it("shows the fallback when the picture fails, and the box is the caller's, the rest goes to the img", async () => {
    const { img, root, box } = mount("broken.png");
    expect(box().classList.contains("size-8")).toBe(true);
    expect(img()!.getAttribute("data-testid")).toBe("pic");
    img()!.dispatchEvent(new Event("error"));
    await nextTick();
    expect(root.querySelector("[data-testid=fallback]")).not.toBeNull();
    expect(img()).toBeNull();
  });

  it("keeps only a short key for a long address", () => {
    const long = `data:image/png;base64,${"A".repeat(5000)}`;
    markSeen(long);
    expect(wasSeen(long)).toBe(true);
    expect(wasSeen(`${long}B`)).toBe(false);
  });
});
