import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { styleMarks, type TavoraTheme } from "@tavora/sdk/protocol";
import type { AppearanceView, HostAction } from "../shared/host-api";
import { translate, type Language } from "../shared/i18n";
import { CLASSIC_STYLE_ID, resolveFontId, resolveRadius } from "../shared/styles";
import { themeFont } from "../shared/ui-fonts";
import { writeFileAtomic } from "./fsutil";
import { LibraryError, switchStyle, type Library } from "./library";
import { panelCorners, type PanelCorners } from "./panel-corners";
import { appearanceThemes, discoverStyles, resolveStyle, starterStyle, STYLE_MANIFEST, STYLE_README, styleManifest, tavoraStyle, type InstalledStyle, type StyleHint, type StyleProblem, type StyleSources } from "./styles";
import {
  DEFAULT_THEME,
  discoverThemes,
  resolveTheme,
  STARTER_README,
  starterTheme,
  THEME_MANIFEST,
  themeManifest,
  variationForMode,
  type InstalledTheme,
  type ThemeHint,
  type ThemeProblem,
  type ThemeSources,
} from "./themes";

/** The themes and styles found, with what was wrong with the ones that could not load. */
export interface InstalledLooks {
  themes: Map<string, InstalledTheme>;
  themeProblems: ThemeProblem[];
  themeHints: ThemeHint[];
  styles: Map<string, InstalledStyle>;
  styleProblems: StyleProblem[];
  styleHints: StyleHint[];
}

export interface AppearanceOptions {
  /** The user's choices live in the library; the caller saves it after a change. */
  library: Library;
  userData: string;
  /** Where themes and styles come from: Tavora's own, then the user's (their data folder's themes and styles folders). */
  sources: { themes: ThemeSources; styles: StyleSources };
  /** The app's language, which names a new copy of a theme or style. */
  language?: () => Language;
  /** Tavora's version, for themes that need a newer one. */
  appVersion: string;
  /** What Host.create found at the start. */
  installed: InstalledLooks;
  /** The system's light or dark setting; asked only while the user follows it. */
  systemMode: () => "dark" | "light";
  /** Shows a folder in the file manager; answers why it could not, or "". */
  openPath: (folder: string) => Promise<string>;
  /** Test runs keep the window hidden and open no file manager. */
  hidden: boolean;
  /**
   * The appearance was worked out again; `changed` when the host's or the panels' theme is not the same as before, so
   * it is shown in the window and every panel.
   */
  applied: (changed: boolean) => void;
}

/** A change to how Tavora looks (Settings > Appearance), as the host UI asks for it. */
export type AppearanceChange = Extract<HostAction, { type: "set-theme" | "set-appearance-mode" | "set-radius" | "set-font" | "set-style" | "reset-theme" }>;

/**
 * How Tavora looks (appearance.ts): the installed themes and styles, the user's pick among them (theme, variation,
 * following the system's mode, radius, font, style), the themes the host and the panels get from it, and the
 * corners of the native views. It decides; showing a new theme in the window and the panels is the caller's
 * (`applied`).
 */
export class Appearance {
  private looks: InstalledLooks;
  private hostTheme: TavoraTheme;
  private panelTheme: TavoraTheme;

  constructor(private readonly options: AppearanceOptions) {
    this.looks = options.installed;
    const { host, panel } = appearanceThemes(this.choice(), this.style(), options.library);
    this.hostTheme = host;
    this.panelTheme = panel;
  }

  /** The theme of the host window, its native views and the overlay pages. */
  get host(): TavoraTheme {
    return this.hostTheme;
  }

  /** The theme module panels get (the host's with the panel style's look). */
  get panel(): TavoraTheme {
    return this.panelTheme;
  }

  /** The corners of the native views now (panel-corners.ts): style, panel style and the radius in use. */
  corners(): PanelCorners {
    return panelCorners(this.style(), this.options.library.panelStyle, this.hostTheme.radius);
  }

  /** Works out the themes again, after the system's mode or a library setting the themes carry changed. */
  refresh(): void {
    const { host, panel } = appearanceThemes(this.choice(), this.style(), this.options.library);
    const changed = JSON.stringify(host) !== JSON.stringify(this.hostTheme) || JSON.stringify(panel) !== JSON.stringify(this.panelTheme);
    if (changed) {
      this.hostTheme = host;
      this.panelTheme = panel;
    }
    this.options.applied(changed);
  }

  /** Applies the user's change to the library and shows it. Throws a LibraryError for a theme that is gone or has no such mode. */
  choose(change: AppearanceChange): void {
    const library = this.options.library;
    switch (change.type) {
      case "set-theme":
        if (!this.looks.themes.get(change.themeId)?.theme.variations.some((variation) => variation.id === change.variationId)) {
          throw new LibraryError("error.themeGone");
        }
        library.theme = { id: change.themeId, variation: change.variationId };
        if (change.fixed) library.followSystem = false;
        break;
      case "set-appearance-mode":
        if (change.mode === "system") {
          library.followSystem = true;
        } else {
          const { theme } = resolveTheme(this.looks.themes, library.theme);
          const variation = variationForMode(theme, library.theme.variation, change.mode);
          if (variation.mode !== change.mode) throw new LibraryError("error.themeNoMode", { mode: translate("en", change.mode === "dark" ? "common.dark" : "common.light") });
          library.theme = { id: theme.id, variation: variation.id };
          library.followSystem = false;
        }
        break;
      case "set-radius":
        library.radius = change.radius;
        break;
      // null is "Style default"; any font, Inter too, is the user's own over the style's.
      case "set-font":
        if (change.font === null) delete library.font;
        else library.font = change.font;
        break;
      // A style that is not installed is kept, like a theme, and shows Classic until it is back.
      // Each style keeps its own theme: one never used starts with its own first theme (Classic: Tavora's), in the mode
      // shown now.
      case "set-style": {
        const picked = this.looks.styles.get(change.styleId)?.style;
        const firstId = picked?.themes.find((id) => this.looks.themes.has(id)) ?? DEFAULT_THEME.id;
        const first = this.looks.themes.get(firstId)?.theme;
        const variation = first ? variationForMode(first, "", this.choice().variation.mode).id : DEFAULT_THEME.variation;
        switchStyle(library, {
          from: resolveStyle(this.looks.styles, library.styleId).id,
          to: change.styleId,
          first: { id: firstId, variation },
          hasTheme: (id) => this.looks.themes.has(id),
        });
        break;
      }
      case "reset-theme":
        library.theme = { ...DEFAULT_THEME };
        library.followSystem = true;
        library.radius = null;
        delete library.font;
        delete library.styleId;
        delete library.styleThemes;
        break;
    }
    this.refresh();
  }

  /** Looks for themes and styles again (they load together, so one Reload finds both) and shows the pick with them. */
  async reload(): Promise<void> {
    const { themes, problems, hints } = await discoverThemes(this.options.sources.themes, this.options.appVersion);
    this.looks = { ...this.looks, themes, themeProblems: problems, themeHints: hints };
    const styles = await discoverStyles(this.options.sources.styles);
    this.looks = { ...this.looks, styles: styles.styles, styleProblems: styles.problems, styleHints: styles.hints };
    this.refresh();
  }

  /**
   * Writes a copy of the Tavora theme (or of the style in use) into the themes (styles) folder, loads it and shows
   * the folder. Answers with its id.
   */
  async createStarter(kind: "theme" | "style"): Promise<string> {
    const root = path.join(this.options.userData, kind === "theme" ? "themes" : "styles");
    await mkdir(root, { recursive: true });
    const base = this.style();
    const starter =
      kind === "theme"
        ? (n: number) => {
            const theme = starterTheme(this.looks.themes, n, this.options.language?.());
            return { id: theme.id, folder: path.join(root, n > 1 ? `my-theme-${n}` : "my-theme"), taken: this.looks.themes.has(theme.id), files: { [THEME_MANIFEST]: themeManifest(theme), "README.txt": STARTER_README } };
          }
        : (n: number) => {
            const style = starterStyle(base, n, this.options.language?.());
            return { id: style.id, folder: path.join(root, style.id.replace(/^local\./, "")), taken: this.looks.styles.has(style.id), files: { [STYLE_MANIFEST]: styleManifest(style), "README.txt": STYLE_README } };
          };
    let suffix = 1;
    while (starter(suffix).taken || existsSync(starter(suffix).folder)) suffix++;
    const { id, folder, files } = starter(suffix);
    await mkdir(folder);
    for (const [name, text] of Object.entries(files)) await writeFileAtomic(path.join(folder, name), text);
    await this.reload();
    if (!this.options.hidden) void this.options.openPath(folder);
    return id;
  }

  /** Shows the themes (styles) folder of the user's data folder, made when needed. */
  async openFolder(kind: "theme" | "style"): Promise<void> {
    const dir = path.join(this.options.userData, kind === "theme" ? "themes" : "styles");
    await mkdir(dir, { recursive: true });
    const error = await this.options.openPath(dir);
    if (error) throw new LibraryError(kind === "theme" ? "error.openThemesFolder" : "error.openStylesFolder", { problem: error });
  }

  /** What Settings > Appearance shows. */
  view(): AppearanceView {
    const library = this.options.library;
    const { theme, variation } = this.choice();
    const style = this.style();
    const fontId = resolveFontId(library.font, style);
    // Classic first, then Tavora's other styles by name, then the user's own by name.
    const styleOrder = (entry: InstalledStyle) => (entry.style.id === CLASSIC_STYLE_ID ? 0 : entry.provenance === "official" ? 1 : 2);
    const styles = [...this.looks.styles.values()].sort((a, b) => styleOrder(a) - styleOrder(b) || a.style.name.localeCompare(b.style.name));
    // Official themes first, the default leading, then the user's own by name.
    const order = (entry: InstalledTheme) => (entry.theme.id === DEFAULT_THEME.id ? 0 : entry.provenance === "official" ? 1 : 2);
    const themes = [...this.looks.themes.values()].sort((a, b) => order(a) - order(b) || a.theme.name.localeCompare(b.theme.name));
    return {
      themeId: theme.id,
      variationId: variation.id,
      isDefault: theme.id === DEFAULT_THEME.id && library.followSystem && library.radius === null && library.font === undefined && style.id === CLASSIC_STYLE_ID,
      followSystem: library.followSystem,
      radius: library.radius,
      resolvedRadius: resolveRadius(library.radius, style, variation.radius),
      // The id as it is: a saved one this Tavora doesn't know shows Inter, and picking Inter still changes it.
      font: { id: fontId, family: themeFont(fontId).family },
      fontOverride: library.font ?? null,
      styleId: style.id,
      styles: styles.map(({ style: item, provenance }) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        author: item.author,
        provenance,
        radius: item.radius,
        font: item.font,
        themes: [...item.themes],
        looks: { ...item.looks },
        values: { ...item.values },
      })),
      // The style as the theme sends it: with glass opacity raised where a theme needs it for contrast.
      styleMarks: styleMarks(this.hostTheme.style ?? tavoraStyle(style)),
      styleProblems: this.looks.styleProblems.map((problem) => ({ ...problem })),
      styleHints: this.looks.styleHints.map((hint) => ({ ...hint })),
      themes: themes.map(({ theme: item, provenance }) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        author: item.author,
        provenance,
        variations: item.variations.map(({ id, name, mode, radius, colors }) => ({ id, name, mode, radius, colors: { ...colors } })),
      })),
      problems: this.looks.themeProblems.map((problem) => ({ ...problem, ...(problem.values ? { values: { ...problem.values } } : {}) })),
      hints: this.looks.themeHints.map((hint) => ({ ...hint })),
    };
  }

  /** The theme and variation in use now: the user's pick, in the mode of the system when following it. */
  private choice() {
    return resolveTheme(this.looks.themes, this.options.library.theme, this.options.library.followSystem ? this.options.systemMode() : undefined);
  }

  /** The style the library names; Classic while it is not installed. */
  private style() {
    return resolveStyle(this.looks.styles, this.options.library.styleId);
  }
}
