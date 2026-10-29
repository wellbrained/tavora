import { describe, expect, it, vi } from "vitest";
import { TavoraError, THEME_TOKENS, type TavoraTheme } from "./index.js";
import { applyHostTheme, bootstrapModule, isGerman, languageOf } from "./bootstrap.js";
import { createMemoryHost } from "./testing.js";

/** The few parts of document.documentElement the helper touches. */
function fakeRoot() {
  const props = new Map<string, string>();
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  const root = {
    style: { setProperty: (name: string, value: string) => props.set(name, value), colorScheme: "" },
    classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
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
