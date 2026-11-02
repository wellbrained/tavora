// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, h, nextTick, type App } from "vue";
import { dismissToast, toast, toasts } from "./toast";
import Toaster from "./Toaster.vue";

// Screen readers hear a toast once, when it arrives (and again only when its content changes), through the Toaster's
// live region. ResizeObserver is not in jsdom; the toasts only need it for their size.
let app: App | undefined;
beforeEach(() => {
  toasts.value = [];
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
  toasts.value = [];
});

function mount(): () => string {
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp({ render: () => h(Toaster) });
  app.mount(root);
  return () => root.querySelector("[role=status]")!.textContent ?? "";
}

describe("Toaster live region", () => {
  it("reads a new toast once and does not read the one behind it again when it leaves", async () => {
    const status = mount();
    toast({ title: "Layout deleted" });
    await nextTick();
    expect(status()).toBe("Layout deleted");
    const second = toast({ title: "Frame deleted" });
    await nextTick();
    expect(status()).toBe("Frame deleted");
    second.dismiss();
    await nextTick();
    // Unchanged: nothing new is read out.
    expect(status()).toBe("Frame deleted");
    dismissToast(toasts.value[0]!.id);
    await nextTick();
    expect(status()).toBe("Frame deleted");
  });

  it("reads the same words twice when two toasts say the same", async () => {
    const status = mount();
    toast({ title: "To-do deleted" });
    await nextTick();
    const first = status();
    toast({ title: "To-do deleted" });
    await nextTick();
    expect(status()).not.toBe(first);
    expect(status().trim()).toBe("To-do deleted");
  });

  it("reads a toast again when its content changes", async () => {
    const status = mount();
    const shown = toast({ title: "Saving…", variant: "loading" });
    await nextTick();
    shown.update({ title: "Saved", variant: "success" });
    await nextTick();
    expect(status()).toBe("Saved");
  });
});
