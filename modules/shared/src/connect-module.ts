import type { TavoraSDK, TavoraTheme } from "@tavora/sdk";
import { bootstrapModule, type BootstrapStatus } from "@tavora/sdk/bootstrap";
import { createTranslator, type Translator } from "./i18n";
import { installTitleTooltips } from "./title-tooltips";
import { applyKitTheme } from "./theme";

export interface ConnectModuleOptions<K extends string> {
  /** The module's texts in both languages; `handle.t` reads them in the language Tavora shows. */
  texts?: { en: Record<K, string>; de: Record<K, string> };
  /** Show title hints as Tavora's tooltips (default true). */
  titleTooltips?: boolean;
  /** A connected SDK to use instead of connecting (for tests). */
  sdk?: TavoraSDK;
}

export interface ModuleHandle<K extends string = string> {
  /** Undefined when `status` is `failed`: show "Could not connect". */
  readonly sdk: TavoraSDK | undefined;
  readonly theme: TavoraTheme | undefined;
  /** The language Tavora shows now, such as "en" or "de". */
  readonly language: string;
  /** Read texts with `t.t(key)` and `t.plural(key, count)`; it follows the language by itself. */
  readonly t: Translator<K>;
  readonly status: BootstrapStatus;
  readonly error?: unknown;
  /** Hears the language when the user changes it (read `language` for now). Returns a way to stop listening. */
  onLanguage(fn: (language: string) => void): () => void;
  /** Hears the theme after it has been applied. Returns a way to stop listening. */
  onTheme(fn: (theme: TavoraTheme) => void): () => void;
  /** Stops following Tavora. The title tooltips stay, as they belong to the page. */
  dispose(): void;
}

/**
 * Connects to Tavora and sets the page up: theme tokens, `--host-*` colours, radius, mode, toast position,
 * the kit's language and `<html lang>`, and the title tooltips. A failed connection does not throw: check `status`.
 * Pass `{}` when you have no texts.
 */
export async function connectModule<K extends string = string>(options: ConnectModuleOptions<K>): Promise<ModuleHandle<K>>;
/** @deprecated Pass an options object (`connectModule({ texts })`) and read `handle.language` / `handle.onLanguage` instead. Called with no argument or a function, it still returns the SDK; removed in a later SDK. */
export async function connectModule(onLanguage?: (language: string) => void): Promise<TavoraSDK>;
export async function connectModule(arg?: ConnectModuleOptions<string> | ((language: string) => void)): Promise<ModuleHandle | TavoraSDK> {
  const legacy = typeof arg !== "object";
  const options: ConnectModuleOptions<string> = legacy ? {} : arg;
  const boot = await bootstrapModule(options.sdk ? { sdk: options.sdk } : {});
  const translator = createTranslator<string>(options.texts?.en ?? {}, options.texts?.de ?? {});

  if (boot.status === "ready") {
    if (boot.theme) applyKitTheme(boot.theme);
    if (options.titleTooltips !== false && typeof document !== "undefined" && document.body) installTitleTooltips(document);
    translator.setLanguage(boot.language);
    boot.onTheme(applyKitTheme);
    boot.onLanguage((language) => translator.setLanguage(language));
  } else if (legacy) {
    throw boot.error;
  }

  if (legacy) {
    if (arg) {
      arg(boot.language);
      boot.onLanguage(arg);
    }
    return boot.sdk as TavoraSDK;
  }

  return {
    get sdk() {
      return boot.sdk;
    },
    get theme() {
      return boot.theme;
    },
    get language() {
      return boot.language;
    },
    t: translator,
    get status() {
      return boot.status;
    },
    get error() {
      return boot.error;
    },
    onLanguage: boot.onLanguage,
    onTheme: boot.onTheme,
    dispose: boot.dispose,
  };
}
