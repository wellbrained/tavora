// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

// The same through Reka's Presence, the way a real dialog is unmounted: it waits for its leaving animation to end,
// unless it has none. jsdom has no animations, so a stylesheet like motion.css gives the dialog an animation name and
// the test ends it with an animationend event.
describe("the kit's dialog leaving through Presence", () => {
  let app: App | undefined;
  let style: HTMLStyleElement | undefined;
  beforeEach(() => {
    style = document.createElement("style");
    style.textContent = [
      '.tavora-dialog[data-state="closed"] { animation-name: tavora-dialog-out; animation-duration: 150ms; }',
      '.tavora-dialog[data-instant][data-state] { animation-name: none; }',
    ].join("\n");
    document.head.append(style);
  });
  afterEach(() => {
    app?.unmount();
    app = undefined;
    style?.remove();
    document.body.innerHTML = "";
    resetInputOrigin();
  });

  function mount() {
    const open = ref(false);
    const root = document.createElement("div");
    document.body.append(root);
    app = createApp(
      defineComponent({
        render: () => h(Dialog, { open: open.value, "onUpdate:open": (value: boolean) => (open.value = value) }, () => h(DialogContent, null, () => h("p", "Hi"))),
      }),
    );
    app.mount(root);
    return { open, content: () => document.body.querySelector<HTMLElement>('[data-slot="dialog-content"]') };
  }
  const press = (type: "keydown" | "pointerdown", key?: string) => document.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
  /** Lets Presence and the watchers behind it finish. */
  const settle = async () => {
    for (let i = 0; i < 3; i++) await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("is gone at once when Escape closed it", async () => {
    const dialog = mount();
    press("keydown", "k");
    dialog.open.value = true;
    await nextTick();
    expect(dialog.content()).not.toBeNull();
    press("keydown", "Escape");
    dialog.open.value = false;
    await settle();
    expect(dialog.content()).toBeNull();
  });

  it("stays until its leaving animation ends when the pointer closed it, and then goes", async () => {
    const dialog = mount();
    press("pointerdown");
    dialog.open.value = true;
    await nextTick();
    expect(dialog.content()?.hasAttribute("data-instant")).toBe(false);
    press("pointerdown");
    dialog.open.value = false;
    await settle();
    const leaving = dialog.content();
    expect(leaving?.getAttribute("data-state")).toBe("closed");
    const ended = Object.assign(new Event("animationend", { bubbles: true }), { animationName: "tavora-dialog-out" });
    leaving?.dispatchEvent(ended);
    await settle();
    expect(dialog.content()).toBeNull();
  });

  it("appears without an animation when a key opened it", async () => {
    const dialog = mount();
    press("keydown", "k");
    dialog.open.value = true;
    await nextTick();
    expect(dialog.content()?.hasAttribute("data-instant")).toBe(true);
    expect(getComputedStyle(dialog.content()!).animationName).toBe("none");
  });
});
