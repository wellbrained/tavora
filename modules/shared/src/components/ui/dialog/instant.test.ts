// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import { resetInputOrigin } from "../sliding-indicator/input-origin";
import Dialog from "./Dialog.vue";
import DialogContent from "./DialogContent.vue";
import { DIALOG_KEY_WINDOW_MS, dialogIsInstant } from "./instant";

// A dialog a key opened appears at once, and one Escape closed leaves at once; with the pointer it moves as always.

describe("dialogIsInstant", () => {
  const key = (name: string, ago = 10) => ({ key: name, ago });

  it("opens at once after a key press, with any key", () => {
    expect(dialogIsInstant("open", false, key("k"))).toBe(true);
    expect(dialogIsInstant("open", false, key("Enter"))).toBe(true);
  });

  it("opens with motion when the latest input was not a key, or the key is old", () => {
    expect(dialogIsInstant("open", false, undefined)).toBe(false);
    expect(dialogIsInstant("open", false, key("k", DIALOG_KEY_WINDOW_MS))).toBe(true);
    expect(dialogIsInstant("open", false, key("k", DIALOG_KEY_WINDOW_MS + 1))).toBe(false);
  });

  it("closes at once for Escape only", () => {
    expect(dialogIsInstant("close", false, key("Escape"))).toBe(true);
    expect(dialogIsInstant("close", false, key("Enter"))).toBe(false);
    expect(dialogIsInstant("close", false, key("Escape", DIALOG_KEY_WINDOW_MS + 1))).toBe(false);
    expect(dialogIsInstant("close", false, undefined)).toBe(false);
  });

  it("a dialog that never animates is instant whatever the input", () => {
    expect(dialogIsInstant("open", true, undefined)).toBe(true);
    expect(dialogIsInstant("close", true, undefined)).toBe(true);
  });
});

describe("the kit's dialog", () => {
  let app: App | undefined;
  afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = "";
    resetInputOrigin();
  });

  /** A dialog that stays in the page when closed (forceMount), so what closing did to it can be read. */
  function mount(content: Record<string, unknown> = {}) {
    const open = ref(false);
    const root = document.createElement("div");
    document.body.append(root);
    app = createApp(
      defineComponent({
        render: () => h(Dialog, { open: open.value, "onUpdate:open": (value: boolean) => (open.value = value) }, () => h(DialogContent, { forceMount: true, ...content }, () => h("p", "Hi"))),
      }),
    );
    app.mount(root);
    const part = (slot: string) => document.body.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
    return { open, content: () => part("dialog-content"), overlay: () => part("dialog-overlay") };
  }

  const press = (type: "keydown" | "pointerdown", key?: string) => document.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));

  it("opens at once after a key press, overlay too", async () => {
    const dialog = mount();
    press("keydown", "k");
    dialog.open.value = true;
    await nextTick();
    expect(dialog.content()?.getAttribute("data-state")).toBe("open");
    expect(dialog.content()?.hasAttribute("data-instant")).toBe(true);
    expect(dialog.overlay()?.hasAttribute("data-instant")).toBe(true);
  });

  it("keeps its motion when it is opened after a press of the pointer", async () => {
    const dialog = mount();
    press("keydown", "k");
    press("pointerdown");
    dialog.open.value = true;
    await nextTick();
    expect(dialog.content()?.getAttribute("data-state")).toBe("open");
    expect(dialog.content()?.hasAttribute("data-instant")).toBe(false);
    expect(dialog.overlay()?.hasAttribute("data-instant")).toBe(false);
  });

  it("keeps its motion when nothing was pressed before it opened", async () => {
    const dialog = mount();
    dialog.open.value = true;
    await nextTick();
    expect(dialog.content()?.hasAttribute("data-instant")).toBe(false);
  });

  it("closes at once with Escape, and with motion when the pointer closed it", async () => {
    const dialog = mount();
    press("pointerdown");
    dialog.open.value = true;
    await nextTick();
    expect(dialog.content()?.hasAttribute("data-instant")).toBe(false);

    press("keydown", "Escape");
    dialog.open.value = false;
    await nextTick();
    expect(dialog.content()?.getAttribute("data-state")).toBe("closed");
    expect(dialog.content()?.hasAttribute("data-instant")).toBe(true);
    expect(dialog.overlay()?.hasAttribute("data-instant")).toBe(true);

    press("pointerdown");
    dialog.open.value = true;
    await nextTick();
    dialog.open.value = false;
    await nextTick();
    expect(dialog.content()?.getAttribute("data-state")).toBe("closed");
    expect(dialog.content()?.hasAttribute("data-instant")).toBe(false);
  });

  it("`instant` makes it appear at once even when the pointer opened it", async () => {
    const dialog = mount({ instant: true });
    press("pointerdown");
    dialog.open.value = true;
    await nextTick();
    expect(dialog.content()?.hasAttribute("data-instant")).toBe(true);
    expect(dialog.overlay()?.hasAttribute("data-instant")).toBe(true);
    // The prop is the kit's own: it does not reach the element as an attribute of its own.
    expect(dialog.content()?.hasAttribute("instant")).toBe(false);
  });
});
