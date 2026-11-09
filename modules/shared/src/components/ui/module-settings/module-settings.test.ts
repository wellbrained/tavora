// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createApp, defineComponent, h, ref, type App } from "vue";
import { ModuleSettings, SettingsPage, SettingsRow, SettingsSection } from ".";

// With only one page there is no menu to pick from: the rows sit on the dialog, and the footer stays (Reset, the
// saved note), without a Done button. With more pages the menu is there as before.

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
});

function mount(pages: string[]) {
  const page = ref<string>(pages[0]!);
  const root = document.createElement("div");
  document.body.append(root);
  const groups = [{ items: pages.map((id) => ({ id, label: id })) }];
  app = createApp(
    defineComponent({
      render: () =>
        h(ModuleSettings, { page: page.value, "onUpdate:page": (value: string) => (page.value = value), groups, label: "Settings", reset: () => () => {} }, () =>
          h(SettingsPage, { title: page.value }, () => h(SettingsSection, null, () => h(SettingsRow, { label: "Row" }, () => "control"))),
        ),
    }),
  );
  app.mount(root);
  return root;
}

describe("ModuleSettings", () => {
  it("leaves the menu out for a single page, and keeps the page and the footer", () => {
    const root = mount(["only"]);
    const settings = root.querySelector("[data-slot=module-settings]")!;
    expect(settings.hasAttribute("data-single")).toBe(true);
    expect(root.querySelector("nav, [role=tablist], [data-slot=nav-list]")).toBeNull();
    expect(root.querySelector("[data-slot=settings-page]")).not.toBeNull();
    expect(root.querySelector("[data-slot=settings-row]")).not.toBeNull();
    expect(root.querySelector("[data-testid=settings-reset]")).not.toBeNull();
    expect(root.querySelector("[data-testid=settings-saved]")).not.toBeNull();
  });

  it("shows the menu for several pages", () => {
    const root = mount(["one", "two"]);
    expect(root.querySelector("[data-slot=module-settings]")!.hasAttribute("data-single")).toBe(false);
    expect(root.textContent).toContain("one");
    expect(root.textContent).toContain("two");
    expect(root.querySelectorAll("button").length).toBeGreaterThan(2);
  });

  it("has no Done button", () => {
    for (const pages of [["only"], ["one", "two"]]) {
      const root = mount(pages);
      expect([...root.querySelectorAll("button")].some((button) => /done/i.test(button.textContent ?? ""))).toBe(false);
      app?.unmount();
      root.remove();
    }
  });
});

describe("Tab order", () => {
  it("puts the Reset button after everything on the page", () => {
    const root = mount(["one", "two"]);
    const page = root.querySelector("[data-slot=settings-page]")!;
    const reset = root.querySelector("[data-testid=settings-reset]")!;
    expect(page.compareDocumentPosition(reset) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(page.contains(reset)).toBe(false);
  });
});
