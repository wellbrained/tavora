// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import SettingsDialog from "./SettingsDialog.vue";

// The Calculator's settings are one page on the kit's ModuleSettings: no menu, no Done button, each row with a short line
// under its name, and a footer with Reset and the note that changes save as you make them.

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
});

async function mount(page: boolean, reset: () => () => void = () => () => {}) {
  const root = document.createElement("div");
  document.body.append(root);
  const short = ref(false);
  app = createApp(
    defineComponent({
      render: () =>
        h(SettingsDialog, {
          page,
          short: short.value,
          decimals: "auto",
          historyLength: "10",
          reset,
          "onUpdate:short": (on: boolean) => (short.value = on),
        }),
    }),
  );
  app.mount(root);
  // An older Tavora's dialog is drawn in a portal, a moment after it mounts.
  for (let turn = 0; turn < 5; turn++) await nextTick();
  return { short };
}

describe.each([
  ["as the page of Tavora's dialog", true],
  ["in the panel of an older Tavora", false],
])("settings %s", (_name, page) => {
  it("is one page of three rows, each with a short line, and no menu", async () => {
    await mount(page);
    expect(document.querySelector("[data-slot=module-settings]")?.hasAttribute("data-single")).toBe(true);
    expect(document.querySelector("[data-slot=nav-list]")).toBeNull();
    const rows = [...document.querySelectorAll("[data-slot=settings-row]")];
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.querySelector("p")?.textContent)).toEqual(["Decimal places", "Short numbers", "History keeps"]);
    // Inside a section every row has a description.
    for (const row of rows) expect(row.querySelectorAll("p")).toHaveLength(2);
    expect(rows[1]?.textContent).toContain("Like 1.5M.");
    expect(document.querySelector("[data-testid=options-decimals]")).not.toBeNull();
    expect(document.querySelector("[data-testid=options-short]")).not.toBeNull();
    expect(document.querySelector("[data-testid=history-length-25]")).not.toBeNull();
  });

  it("has no Done button, and the footer has Reset and says changes save by themselves", async () => {
    await mount(page);
    expect(document.querySelector("[data-testid=settings-done]")).toBeNull();
    expect([...document.querySelectorAll("button")].some((button) => /done/i.test(button.textContent ?? ""))).toBe(false);
    expect(document.querySelector("[data-testid=settings-reset]")?.textContent).toContain("Reset this page");
    expect(document.querySelector("[data-testid=settings-saved]")?.textContent).toContain("Changes save as you make them.");
  });

  it("asks the panel to reset when Reset is pressed", async () => {
    const reset = vi.fn(() => () => {});
    await mount(page, reset);
    document.querySelector<HTMLElement>("[data-testid=settings-reset]")!.click();
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe("the short numbers switch", () => {
  it("hands its change to the panel at once", async () => {
    const { short } = await mount(true);
    document.querySelector<HTMLElement>("[data-testid=options-short]")!.click();
    expect(short.value).toBe(true);
  });
});
