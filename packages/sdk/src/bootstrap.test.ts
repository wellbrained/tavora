import { describe, expect, it, vi } from "vitest";
import { CLASSIC_STYLE, STYLE_PARTS, STYLE_TAVORA, TavoraError, THEME_TOKENS, type TavoraStyle, type TavoraTheme } from "./index.js";
import { applyHostTheme, bootstrapModule, isGerman, languageOf } from "./bootstrap.js";
import { createMemoryHost } from "./testing.js";

/** The few parts of document.documentElement the helper touches. */
function fakeRoot() {
  const props = new Map<string, string>();
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  const root = {
    style: { setProperty: (name: string, value: string) => props.set(name, value), removeProperty: (name: string) => props.delete(name), colorScheme: "" },
    classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  };
  return { root: root as unknown as HTMLElement, props, classes, attributes };
}

const COLORS = { background: "#111111", surface: "#222222", text: "#eeeeee", textMuted: "#999999", accent: "#6d8cff" };
const lightTheme = (extra: Partial<TavoraTheme> = {}): Partial<TavoraTheme> => ({ mode: "light", radius: 6, colors: { ...COLORS, background: "#ffffff", text: "#111111" }, ...extra });

describe("applyHostTheme", () => {
  it("sets every token, the --host-* colours, the radius, the colour scheme, the dark class and data-mode", async () => {
    const { sdk } = createMemoryHost();
    const theme = await sdk.ui.getTheme();
    const page = fakeRoot();
    applyHostTheme({ ...theme, colors: COLORS, radius: 10 }, page.root);
    for (const name of THEME_TOKENS) expect(page.props.get(`--${name}`), name).toBe(theme.tokens[name]);
    expect(page.props.get("--host-background")).toBe("#111111");
    expect(page.props.get("--host-surface")).toBe("#222222");
    expect(page.props.get("--host-text")).toBe("#eeeeee");
    expect(page.props.get("--host-text-muted")).toBe("#999999");
    expect(page.props.get("--host-accent")).toBe("#6d8cff");
    expect(page.props.get("--radius")).toBe("10px");
    expect(page.root.style.colorScheme).toBe("dark");
    expect(page.classes.has("dark")).toBe(true);
    expect(page.attributes.get("data-mode")).toBe("dark");
  });

  it("follows light mode and skips what the theme leaves out", () => {
    const page = fakeRoot();
    page.classes.add("dark");
    applyHostTheme({ mode: "light", radius: Number.NaN, tokens: { primary: "#2a5f9e" } } as unknown as TavoraTheme, page.root);
    expect(page.props.get("--primary")).toBe("#2a5f9e");
    expect(page.props.has("--radius")).toBe(false);
    expect(page.props.has("--host-text")).toBe(false);
    expect(page.root.style.colorScheme).toBe("light");
    expect(page.classes.has("dark")).toBe(false);
    expect(page.attributes.get("data-mode")).toBe("light");
    expect(page.props.has("--tavora-font-sans")).toBe(false);
  });

  it("sets the font as --tavora-font-sans, so the page can switch fonts while it is open", () => {
    const page = fakeRoot();
    applyHostTheme({ mode: "dark", font: { id: "allo", family: '"Allo Variable", system-ui, sans-serif' } } as unknown as TavoraTheme, page.root);
    expect(page.props.get("--tavora-font-sans")).toBe('"Allo Variable", system-ui, sans-serif');
  });
});

const HARDWARE: TavoraStyle = {
  id: "tavora.hardware",
  name: "Hardware",
  looks: { surface: "raised", tabs: "keycap", content: "inset", buttons: "keycap", inputs: "inset", lists: "inverted", labels: "caps-mono", status: "led", numbers: "dot" },
  values: { borderWidth: 0, depth: 2, textSize: 12.5, controlHeight: 30, spacing: 0.9, glassOpacity: 0.8 },
};
const STYLE_VARS = ["--style-border-width", "--style-depth", "--style-text", "--style-control-height", "--style-space", "--style-glass-opacity"];

describe("applyHostTheme: the design style", () => {
  it("writes data-style, a data-look per part and the six --style-* variables", () => {
    const page = fakeRoot();
    applyHostTheme({ mode: "dark", style: HARDWARE } as unknown as TavoraTheme, page.root);
    expect(page.attributes.get("data-style")).toBe("tavora.hardware");
    expect(Object.fromEntries(STYLE_PARTS.map((part) => [part, page.attributes.get(`data-look-${part}`)]))).toEqual(HARDWARE.looks);
    expect(STYLE_VARS.map((name) => page.props.get(name))).toEqual(["0px", "2", "12.5px", "30px", "0.9", "0.8"]);
  });

  it("writes Classic as its values", () => {
    const page = fakeRoot();
    applyHostTheme({ mode: "dark", style: CLASSIC_STYLE } as unknown as TavoraTheme, page.root);
    expect(page.attributes.get("data-style")).toBe("tavora.classic");
    expect(page.attributes.get("data-look-tabs")).toBe("pill");
    expect(STYLE_VARS.map((name) => page.props.get(name))).toEqual(["1px", "1", "13px", "32px", "1", "0.8"]);
  });

  it("sets nothing without a style, and takes away what an earlier theme wrote", () => {
    const fresh = fakeRoot();
    applyHostTheme({ mode: "dark" } as unknown as TavoraTheme, fresh.root);
    expect([...fresh.attributes.keys()]).toEqual(["data-mode"]);
    expect(STYLE_VARS.some((name) => fresh.props.has(name))).toBe(false);

    const page = fakeRoot();
    applyHostTheme({ mode: "dark", style: HARDWARE } as unknown as TavoraTheme, page.root);
    applyHostTheme({ mode: "dark" } as unknown as TavoraTheme, page.root);
    expect([...page.attributes.keys()]).toEqual(["data-mode"]);
    expect(STYLE_VARS.some((name) => page.props.has(name))).toBe(false);
  });

  it("leaves out a look or value it can't use, and never writes markup into an attribute", () => {
    const page = fakeRoot();
    applyHostTheme({ mode: "dark", style: HARDWARE } as unknown as TavoraTheme, page.root);
    const broken = { ...HARDWARE, id: '"><x', looks: { ...HARDWARE.looks, tabs: 3, lists: "Bar Bar" }, values: { ...HARDWARE.values, depth: Number.NaN, textSize: "14" } };
    applyHostTheme({ mode: "dark", style: broken } as unknown as TavoraTheme, page.root);
    expect(page.attributes.has("data-style")).toBe(false);
    expect(page.attributes.has("data-look-tabs")).toBe(false);
    expect(page.attributes.has("data-look-lists")).toBe(false);
    expect(page.attributes.get("data-look-buttons")).toBe("keycap");
    expect(page.props.has("--style-depth")).toBe(false);
    expect(page.props.has("--style-text")).toBe(false);
    expect(page.props.get("--style-control-height")).toBe("30px");
  });

  it("still works on a root that can't remove anything", () => {
    const page = fakeRoot();
    const root = page.root as unknown as { removeAttribute?: unknown; style: { removeProperty?: unknown } };
    delete root.removeAttribute;
    delete root.style.removeProperty;
    expect(() => applyHostTheme({ mode: "dark" } as unknown as TavoraTheme, page.root)).not.toThrow();
  });

  it("follows the style as the host changes it, and a Tavora older than STYLE_TAVORA sends none", async () => {
    const { sdk, host } = createMemoryHost();
    const page = fakeRoot();
    const boot = await bootstrapModule({ sdk, root: page.root });
    expect(page.attributes.get("data-style")).toBe("tavora.classic");
    host.changeTheme({ style: HARDWARE });
    await vi.waitFor(() => expect(page.attributes.get("data-look-surface")).toBe("raised"));
    host.changeTheme({ style: undefined });
    await vi.waitFor(() => expect(page.attributes.has("data-style")).toBe(false));
    expect(page.props.has("--style-text")).toBe(false);
    boot.dispose();

    const older = createMemoryHost({ version: "0.24.103", theme: { style: HARDWARE } });
    expect(STYLE_TAVORA > "0.24.103").toBe(true);
    expect((await older.sdk.ui.getTheme()).style).toBeUndefined();
  });
});

describe("language helpers", () => {
  it("count de, de-AT and de_DE as German and everything else as English", () => {
    expect(["de", "DE", "de-AT", "de_DE"].every(isGerman)).toBe(true);
    expect(["en", "en-GB", "fr", "", "deu"].some(isGerman)).toBe(false);
    expect(languageOf("de-CH")).toBe("de");
    expect(languageOf("fr")).toBe("en");
  });
});

describe("bootstrapModule", () => {
  it("connects, applies the theme and tracks the language now and on change", async () => {
    const { sdk, host } = createMemoryHost();
    host.setLanguage("de");
    const page = fakeRoot();
    const boot = await bootstrapModule({ sdk, root: page.root });
    expect(boot.status).toBe("ready");
    expect(boot.sdk).toBe(sdk);
    expect(boot.language).toBe("de");
    expect(boot.theme?.mode).toBe("dark");
    expect(page.props.get("--host-accent")).toBeTruthy();

    const languages: string[] = [];
    boot.onLanguage((language) => languages.push(language));
    host.setLanguage("en");
    expect(boot.language).toBe("en");
    expect(languages).toEqual(["en"]);

    const modes: string[] = [];
    boot.onTheme((theme) => modes.push(theme.mode));
    host.changeTheme(lightTheme());
    expect(boot.theme?.mode).toBe("light");
    expect(modes).toEqual(["light"]);
    expect(page.root.style.colorScheme).toBe("light");
    expect(page.classes.has("dark")).toBe(false);
    expect(page.attributes.get("data-mode")).toBe("light");
    expect(page.props.get("--host-background")).toBe("#ffffff");
    expect(page.props.get("--radius")).toBe("6px");
  });

  it("onLanguage and onTheme give back a way to stop listening", async () => {
    const { sdk, host } = createMemoryHost();
    const boot = await bootstrapModule({ sdk, root: fakeRoot().root });
    const fn = vi.fn();
    boot.onLanguage(fn)();
    host.setLanguage("de");
    expect(fn).not.toHaveBeenCalled();
  });

  it("dispose removes every listener it added", async () => {
    const { sdk, host } = createMemoryHost();
    const page = fakeRoot();
    const boot = await bootstrapModule({ sdk, root: page.root });
    const fn = vi.fn();
    boot.onLanguage(fn);
    boot.onTheme(fn);
    boot.dispose();
    page.props.clear();
    host.setLanguage("de");
    host.changeTheme(lightTheme());
    expect(fn).not.toHaveBeenCalled();
    expect(boot.language).toBe("en");
    expect(page.props.size).toBe(0);
    boot.dispose();
  });

  it("connects by itself when no sdk is given", async () => {
    const { sdk } = createMemoryHost();
    const boot = await bootstrapModule({ connect: async () => sdk, root: fakeRoot().root });
    expect(boot.status).toBe("ready");
    expect(boot.sdk).toBe(sdk);
  });

  it("a failed connect gives status failed with the error, and still returns", async () => {
    const error = new TavoraError({ code: "INTERNAL", message: "no host" });
    const boot = await bootstrapModule({ connect: async () => Promise.reject(error), root: fakeRoot().root });
    expect(boot.status).toBe("failed");
    expect(boot.error).toBe(error);
    expect(boot.sdk).toBeUndefined();
    expect(boot.theme).toBeUndefined();
    expect(boot.language).toBe("en");
    expect(() => boot.dispose()).not.toThrow();
  });

  it("a host that fails to answer the theme is failed too, without leaving listeners", async () => {
    const { sdk, host } = createMemoryHost();
    host.answer("ui.getTheme", () => {
      throw new TavoraError({ code: "INTERNAL", message: "boom" });
    });
    const boot = await bootstrapModule({ sdk, root: fakeRoot().root });
    expect(boot.status).toBe("failed");
    expect(boot.error).toBeInstanceOf(TavoraError);
  });
});
