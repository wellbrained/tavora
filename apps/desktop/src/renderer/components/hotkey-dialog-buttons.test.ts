// @vitest-environment jsdom
// The hotkey dialog catches every key to pick a combo, but Enter and Space on its own buttons still press them, so Remove
// and Cancel work from the keyboard before any combo is picked. The host is a fake.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, type App } from "vue";

vi.mock("../host", async () => {
  const { shallowRef } = await import("vue");
  return { act: vi.fn(), state: shallowRef({ hotkeyRequest: { id: "h1", actionName: "Jump", label: "Jump", moduleName: "Notes", current: "Ctrl+J", error: null } }) };
});
vi.mock("./ModalDialog.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) }) };
});
vi.mock("@tavora/official-ui/components/ui/dialog", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    DialogFooter: defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) }),
    DialogButton: defineComponent({ inheritAttrs: false, setup: (_, { slots, attrs }) => () => h("button", { type: "button", "data-testid": attrs["data-testid"] }, slots.default?.()) }),
  };
});

import HotkeyDialog from "./HotkeyDialog.vue";

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = "";
});

function press(target: Element, code: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { code, key: code === "Space" ? " " : code, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe("HotkeyDialog keys", () => {
  it("lets Enter and Space press its own buttons, but catches them elsewhere", () => {
    const root = document.createElement("div");
    document.body.append(root);
    app = createApp(defineComponent({ render: () => h(HotkeyDialog) }));
    app.mount(root);
    const remove = root.querySelector('[data-testid="hotkey-remove"]')!;
    expect(press(remove, "Enter").defaultPrevented).toBe(false);
    expect(press(remove, "Space").defaultPrevented).toBe(false);
    expect(press(root, "Enter").defaultPrevented).toBe(true);
    expect(press(remove, "KeyA").defaultPrevented).toBe(true);
  });
});
