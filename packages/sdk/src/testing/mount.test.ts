// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { bootstrapModule } from "../bootstrap.js";
import { connect, type TavoraSDK } from "../index.js";
import { takeTestSdk } from "../test-slot.js";
import { mountPanel, themeOf, type MountedPanel } from "../testing.js";

/** A page that starts like a module's entry: connects, then draws. */
function page(onSdk?: (sdk: TavoraSDK, container: HTMLElement) => void) {
  return async (container: HTMLElement) => {
    const sdk = await connect();
    container.innerHTML = `<button data-testid="save">Save</button>`;
    onSdk?.(sdk, container);
    return () => container.replaceChildren();
  };
}

const open: MountedPanel[] = [];
const mount = async (...args: Parameters<typeof mountPanel>) => {
  const panel = await mountPanel(...args);
  open.push(panel);
  return panel;
};
afterEach(async () => {
  for (const panel of open.splice(0)) await panel.unmount();
  document.body.replaceChildren();
});

describe("mountPanel", () => {
  it("hands the page's own connect() this panel's memory host, and waits until the page connected", async () => {
    let got: TavoraSDK | undefined;
    const panel = await mount({ start: page((sdk) => (got = sdk)) });
    expect(got).toBe(panel.sdk);
    expect(panel.container.querySelector("[data-testid=save]")).not.toBeNull();
    expect(panel.container.isConnected).toBe(true);
    await panel.sdk.storage.set("view", "grid");
    expect(panel.host.storage.get("view")).toBe("grid");
  });

  it("works through bootstrapModule, and a later connect() of the page gets the same SDK", async () => {
    let booted: TavoraSDK | undefined;
    const panel = await mount({
      language: "de",
      start: async () => {
        booted = (await bootstrapModule({ root: document.documentElement })).sdk;
      },
    });
    expect(booted).toBe(panel.sdk);
    expect(await connect()).toBe(panel.sdk);
    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
    expect(await panel.sdk.ui.getLanguage()).toBe("de");
  });

  it("starts like Tavora: Tavora Dark, and calls that need a press refused without one", async () => {
    const panel = await mount({ start: page() });
    expect(await panel.sdk.ui.getTheme()).toEqual(themeOf("dark"));
    await expect(panel.sdk.links.open("https://example.com")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("counts a real press in the panel as one gesture; a scripted click() is none", async () => {
    const panel = await mount({ start: page() });
    const button = panel.container.querySelector("button")!;
    button.click();
    await expect(panel.sdk.links.open("https://example.com")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await panel.sdk.links.open("https://example.com");
    // One press, one call.
    await expect(panel.sdk.links.open("https://example.com")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await panel.sdk.links.open("https://example.com");
  });

  it("gives a press outside every panel (a dialog at the end of the page) to the panel pressed last", async () => {
    const first = await mount({ start: page() });
    const second = await mount({ share: first.host, start: page() });
    const dialog = document.body.appendChild(document.createElement("div"));
    second.container.querySelector("button")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await second.sdk.links.open("https://example.com");
    dialog.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await second.sdk.links.open("https://example.com");
    await expect(first.sdk.links.open("https://example.com")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("gives each panel its own host, also when they start at once; share makes them one module", async () => {
    const seen: TavoraSDK[] = [];
    const [a, b] = await Promise.all([mount({ start: page((sdk) => seen.push(sdk)) }), mount({ start: page((sdk) => seen.push(sdk)) })]);
    expect(seen).toEqual([a!.sdk, b!.sdk]);
    expect(a!.sdk).not.toBe(b!.sdk);
    await a!.sdk.storage.set("k", 1);
    expect(b!.host.storage.get("k")).toBeNull();
    const c = await mount({ share: a!.host, start: page() });
    expect(c.host.storage.get("k")).toBe(1);
  });

  it("closes like Tavora: onDispose first, then the page is taken down; reopened with share, the storage is still there", async () => {
    const order: string[] = [];
    const panel = await mountPanel({
      start: async (container) => {
        const sdk = await connect();
        sdk.lifecycle.onDispose(() => order.push("dispose"));
        await sdk.storage.set("draft", "hello");
        return () => void order.push(`stop:${container.isConnected}`);
      },
    });
    const container = panel.container;
    await panel.unmount();
    await panel.unmount();
    expect(order).toEqual(["dispose", "stop:true"]);
    expect(container.isConnected).toBe(false);
    expect(takeTestSdk()).toBeUndefined();

    const again = await mount({ share: panel.host, start: page() });
    expect(again.host.storage.get("draft")).toBe("hello");
  });

  it("draws into a container the test gives, and leaves it on the page", async () => {
    const container = document.body.appendChild(document.createElement("section"));
    const panel = await mountPanel({ container, start: page() });
    expect(panel.container).toBe(container);
    await panel.unmount();
    expect(container.isConnected).toBe(true);
    expect(container.childElementCount).toBe(0);
  });

  it("fails clearly when the page never connects, and cleans up", async () => {
    let drawn: HTMLElement | undefined;
    await expect(mountPanel({ connectTimeoutMs: 30, start: (container) => void (drawn = container) })).rejects.toThrow(/did not connect within 30 ms/);
    expect(drawn?.isConnected).toBe(false);
    expect(takeTestSdk()).toBeUndefined();
    // The next panel still starts.
    const panel = await mount({ start: page() });
    expect(panel.sdk).toBeDefined();
  });

  it("passes on an error from start", async () => {
    await expect(mountPanel({ start: () => Promise.reject(new Error("boom")) })).rejects.toThrow("boom");
    expect(takeTestSdk()).toBeUndefined();
  });
});
