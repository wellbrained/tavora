// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, type App } from "vue";
import SettingsPreview from "./SettingsPreview.vue";

// The backdrop switch is the kit's segmented control in its small size.

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("SettingsPreview backdrop buttons", () => {
  it("is one Tab stop that lands on the picked backdrop", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    app = createApp({ render: () => h(SettingsPreview, { label: "Preview" }) });
    app.mount(root);
    await new Promise((done) => setTimeout(done));
    const buttons = [...root.querySelectorAll<HTMLElement>("[role=radio]")];
    expect(buttons.every((button) => button.tabIndex === -1)).toBe(true);
    root.querySelector<HTMLElement>("[role=radiogroup]")!.focus();
    await new Promise((done) => setTimeout(done));
    expect((document.activeElement as HTMLElement | null)?.dataset.testid).toBe("settings-backdrop-game");
  });
});
