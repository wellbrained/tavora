import { connect } from "@tavora/sdk";
import { createMemoryHost } from "@tavora/sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tavora/sdk", async (original) => ({ ...(await original<typeof import("@tavora/sdk")>()), connect: vi.fn() }));
vi.mock("./title-tooltips", () => ({ installTitleTooltips: vi.fn() }));

import { connectModule } from "./connect-module";
import { onFontChange } from "./theme";
import { installTitleTooltips } from "./title-tooltips";
import { toastPosition } from "./components/ui/toast/toast";
import { toastsPaused } from "./components/ui/toast/visibility";

const texts = {
  en: { hello: "Hello {name}", "left.one": "{count} left", "left.other": "{count} left (many)" },
  de: { hello: "Hallo {name}", "left.one": "{count} übrig", "left.other": "{count} übrig (viele)" },
};

let root: { style: { props: Map<string, string>; setProperty(name: string, value: string): void; colorScheme: string }; classList: { toggle(name: string, on: boolean): void }; setAttribute(name: string, value: string): void; lang: string; attributes: Map<string, string> };

beforeEach(() => {
  const props = new Map<string, string>();
  const attributes = new Map<string, string>();
  root = {
    style: { props, setProperty: (name, value) => void props.set(name, value), colorScheme: "" },
    classList: { toggle: () => {} },
    setAttribute: (name, value) => void attributes.set(name, value),
    lang: "",
    attributes,
  };
  vi.stubGlobal("document", { documentElement: root, body: {} });
  vi.mocked(installTitleTooltips).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("connectModule({ texts })", () => {
  it("sets the page up and returns a handle that follows the language", async () => {
    const { sdk, host } = createMemoryHost();
    host.setLanguage("de");
    const handle = await connectModule({ texts, sdk });
    expect(handle.status).toBe("ready");
    expect(handle.sdk).toBe(sdk);
    expect(handle.language).toBe("de");
    expect(handle.t.t("hello", { name: "Alex" })).toBe("Hallo Alex");
    expect(root.lang).toBe("de");

    const heard: string[] = [];
    handle.onLanguage((language) => heard.push(language));
    host.setLanguage("en");
    expect(handle.language).toBe("en");
    expect(handle.t.t("hello", { name: "Alex" })).toBe("Hello Alex");
    expect(handle.t.plural("left", 1)).toBe("1 left");
    expect(root.lang).toBe("en");
    expect(heard).toEqual(["en"]);
  });

  it("applies the host theme with the kit's extras, now and on change", async () => {
    const { sdk, host } = createMemoryHost();
    await connectModule({ sdk });
    expect(root.style.props.get("--host-accent")).toBeTruthy();
    expect([...root.style.props.keys()].some((name) => name.startsWith("--tavora-tooltip-"))).toBe(true);
    host.changeTheme({ mode: "light", toasts: "top-center" });
    expect(root.attributes.get("data-mode")).toBe("light");
    expect(toastPosition.value).toBe("top-center");
  });

  it("writes the font the user picked, and tells measuring components when it changes, not for any other theme change", async () => {
    vi.useFakeTimers();
    try {
      const { sdk, host } = createMemoryHost({ theme: { font: { id: "inter", family: '"Inter Variable", sans-serif' } } });
      await connectModule({ sdk });
      // An earlier test's page had another font; this page's first theme is no change for it.
      await vi.runAllTimersAsync();
      const heard = vi.fn();
      const stop = onFontChange(heard);
      host.changeTheme({ mode: "light" });
      await vi.runAllTimersAsync();
      expect(heard).not.toHaveBeenCalled();
      host.changeTheme({ font: { id: "allo", family: '"Allo Variable", sans-serif' } });
      expect(root.style.props.get("--tavora-font-sans")).toBe('"Allo Variable", sans-serif');
      await vi.runAllTimersAsync();
      expect(heard).toHaveBeenCalled();
      stop();
      heard.mockClear();
      host.changeTheme({ font: { id: "inter", family: '"Inter Variable", sans-serif' } });
      await vi.runAllTimersAsync();
      expect(heard).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds toast timers while the host says the panel is hidden, and lets go when disposed", async () => {
    const { sdk, host } = createMemoryHost();
    const handle = await connectModule({ sdk });
    expect(toastsPaused.value).toBe(false);
    host.suspend();
    expect(toastsPaused.value).toBe(true);
    host.resume();
    expect(toastsPaused.value).toBe(false);
    host.suspend();
    handle.dispose();
    expect(toastsPaused.value).toBe(false);
  });

  it("holds toast timers while the host says the window is behind the game, and lets go when disposed", async () => {
    const { sdk, host } = createMemoryHost();
    const handle = await connectModule({ sdk });
    host.behind();
    expect(toastsPaused.value).toBe(true);
    host.behind(false);
    expect(toastsPaused.value).toBe(false);
    host.behind();
    handle.dispose();
    expect(toastsPaused.value).toBe(false);
  });

  it("installs the title tooltips unless asked not to", async () => {
    await connectModule({ sdk: createMemoryHost().sdk });
    expect(installTitleTooltips).toHaveBeenCalledTimes(1);
    await connectModule({ sdk: createMemoryHost().sdk, titleTooltips: false });
    expect(installTitleTooltips).toHaveBeenCalledTimes(1);
  });

  it("dispose stops following the host", async () => {
    const { sdk, host } = createMemoryHost();
    const handle = await connectModule({ texts, sdk });
    handle.dispose();
    host.setLanguage("de");
    expect(handle.t.t("hello", { name: "A" })).toBe("Hello A");
  });
});

describe("connectModule when Tavora is not there", () => {
  it("returns a failed handle instead of throwing", async () => {
    const error = new Error("no host");
    vi.mocked(connect).mockRejectedValueOnce(error);
    const handle = await connectModule({ texts });
    expect(handle.status).toBe("failed");
    expect(handle.error).toBe(error);
    expect(handle.sdk).toBeUndefined();
    expect(handle.t.t("hello")).toBe("Hello {name}");
    expect(installTitleTooltips).not.toHaveBeenCalled();
  });
});
