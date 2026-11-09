// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, type App } from "vue";
import SettingsPreview from "./SettingsPreview.vue";

// The backdrop buttons are the kit's small button size (24 px high, 12 px text), never under 12 px.

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("SettingsPreview backdrop buttons", () => {
  it("use the 12 px text and 24 px height of the small button", () => {
    const root = document.createElement("div");
    document.body.append(root);
    app = createApp({ render: () => h(SettingsPreview, { label: "Preview" }) });
    app.mount(root);
    const buttons = [...root.querySelectorAll<HTMLElement>("[role=radio]")];
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.className).toContain("text-xs");
      expect(button.className).toContain("h-6");
      expect(button.className).not.toContain("text-[11px]");
    }
  });
});
