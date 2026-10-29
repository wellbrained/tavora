import { connect } from "@tavora/sdk";
import { createMemoryHost } from "@tavora/sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tavora/sdk", async (original) => ({ ...(await original<typeof import("@tavora/sdk")>()), connect: vi.fn() }));
vi.mock("./title-tooltips", () => ({ installTitleTooltips: vi.fn() }));

import { connectModule } from "./connect-module";
import { installTitleTooltips } from "./title-tooltips";
import { toastPosition } from "./components/ui/toast/toast";

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

describe("connectModule(onLanguage) (deprecated)", () => {
  it("gives the language now and on change, and returns the sdk", async () => {
    const { sdk, host } = createMemoryHost();
    host.setLanguage("de");
    vi.mocked(connect).mockResolvedValueOnce(sdk);
    const heard: string[] = [];
    const connected = await connectModule((language: string) => heard.push(language));
    expect(connected).toBe(sdk);
    host.setLanguage("en");
    expect(heard).toEqual(["de", "en"]);
    expect(root.style.props.get("--host-accent")).toBeTruthy();
  });

  it("works without a callback and rejects when there is no host", async () => {
    const { sdk } = createMemoryHost();
    vi.mocked(connect).mockResolvedValueOnce(sdk);
    expect(await connectModule()).toBeTruthy();
    const error = new Error("no host");
    vi.mocked(connect).mockRejectedValueOnce(error);
    await expect(connectModule((language: string) => void language)).rejects.toBe(error);
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
