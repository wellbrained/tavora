// Module bootstrap: connect, follow the host's theme and language, and clean up after itself.
//
// Framework-free client code (no Vue, no kit): every module, in any framework, starts the same way. The kit's
// `connectModule` builds on this and adds its own parts (translator, toasts, tooltips). See ADR-0002.

import { connect, THEME_TOKENS, type TavoraSDK, type TavoraTheme } from "./index.js";

/** The few parts of an element the theme is written to; `document.documentElement` fits. */
export interface ThemeRoot {
  style: { setProperty(name: string, value: string): void; colorScheme: string };
  classList: { toggle(name: string, force?: boolean): unknown };
  setAttribute(name: string, value: string): void;
}

/** Anything but German is English, as in the host. */
export function isGerman(language: string): boolean {
  return language.toLowerCase().split(/[-_]/)[0] === "de";
}

/** The language a module shows its texts in: "de" or "en". */
export function languageOf(language: string): "en" | "de" {
  return isGerman(language) ? "de" : "en";
}

/** `--host-*` variable name for a `theme.colors` key: `textMuted` becomes `--host-text-muted`. */
const hostVariable = (name: string) => `--host-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

/**
 * Writes the host theme to the page: every theme token as `--<token>`, the summary colours as `--host-<name>`
 * (`--host-background`, `--host-text`, …), `--radius`, `color-scheme`, the `dark` class and `data-mode`
 * (`"dark"` or `"light"`). A part the theme leaves out is left as it was.
 */
export function applyHostTheme(theme: TavoraTheme, root: ThemeRoot = document.documentElement): void {
  for (const name of THEME_TOKENS) {
    const value = theme.tokens?.[name];
    if (typeof value === "string" && value) root.style.setProperty(`--${name}`, value);
  }
  for (const [name, value] of Object.entries(theme.colors ?? {})) {
    if (typeof value === "string" && value) root.style.setProperty(hostVariable(name), value);
  }
  if (typeof theme.radius === "number" && Number.isFinite(theme.radius)) root.style.setProperty("--radius", `${theme.radius}px`);
  const mode = theme.mode === "light" ? "light" : "dark";
  root.style.colorScheme = mode;
  root.classList.toggle("dark", mode === "dark");
  root.setAttribute("data-mode", mode);
}

/** `connecting` is what a page shows before `bootstrapModule` settles; the promise itself only gives `ready` or `failed`. */
export type BootstrapStatus = "connecting" | "ready" | "failed";

export interface BootstrapOptions {
  /** An SDK that is connected already (a test host, say). Without it, `connect()` is called. */
  sdk?: TavoraSDK;
  /** Replaces `connect()`; mostly for tests. */
  connect?: () => Promise<TavoraSDK>;
  /** Where the theme is written. Default: `document.documentElement`. */
  root?: ThemeRoot;
}

export interface ModuleBootstrap {
  /** Undefined when `status` is `failed`. */
  readonly sdk: TavoraSDK | undefined;
  /** The host theme now; undefined when `status` is `failed`. */
  readonly theme: TavoraTheme | undefined;
  /** The language the host shows its texts in now, such as "en" or "de" ("en" when `failed`). */
  readonly language: string;
  readonly status: BootstrapStatus;
  /** Why it failed, when `status` is `failed`. */
  readonly error?: unknown;
  /** Hears the language when the user changes it (not now: read `language`). Returns a way to stop listening. */
  onLanguage(fn: (language: string) => void): () => void;
  /** Hears the theme after it has been applied to the page (not now: read `theme`). Returns a way to stop listening. */
  onTheme(fn: (theme: TavoraTheme) => void): () => void;
  /** Stops following the host and drops every listener. Safe to call twice. */
  dispose(): void;
}

/**
 * Connects, applies the host theme now and whenever it changes, and tracks the language. A failed connection does not
 * throw: the result has `status` `failed` and the `error`, so the page can say "Could not connect".
 */
export async function bootstrapModule(options: BootstrapOptions = {}): Promise<ModuleBootstrap> {
  const languageListeners = new Set<(language: string) => void>();
  const themeListeners = new Set<(theme: TavoraTheme) => void>();
  const stops: Array<() => void> = [];
  let sdk: TavoraSDK | undefined;
  let theme: TavoraTheme | undefined;
  let language = "en";
  let status: BootstrapStatus = "connecting";
  let error: unknown;
  let disposed = false;

  const dispose = () => {
    disposed = true;
    for (const stop of stops.splice(0)) stop();
    languageListeners.clear();
    themeListeners.clear();
  };

  try {
    sdk = options.sdk ?? (await (options.connect ?? connect)());
    const apply = (next: TavoraTheme) => {
      if (disposed) return;
      theme = next;
      applyHostTheme(next, options.root);
      for (const fn of [...themeListeners]) fn(next);
    };
    stops.push(
      sdk.ui.onThemeChange(apply),
      sdk.ui.onLanguageChange((next) => {
        if (disposed) return;
        language = next;
        for (const fn of [...languageListeners]) fn(next);
      }),
    );
    apply(await sdk.ui.getTheme());
    language = await sdk.ui.getLanguage();
    status = "ready";
  } catch (cause) {
    dispose();
    sdk = undefined;
    theme = undefined;
    language = "en";
    status = "failed";
    error = cause;
  }

  const listen = <T>(set: Set<T>, fn: T) => {
    if (!disposed) set.add(fn);
    return () => void set.delete(fn);
  };
  return {
    get sdk() {
      return sdk;
    },
    get theme() {
      return theme;
    },
    get language() {
      return language;
    },
    get status() {
      return status;
    },
    get error() {
      return error;
    },
    onLanguage: (fn) => listen(languageListeners, fn),
    onTheme: (fn) => listen(themeListeners, fn),
    dispose,
  };
}
