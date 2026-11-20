---
updated: 2026-11-20
---
# Style system

Lets Nik (later others) change Tavora's whole design language while the structure stays. Grilled with Nik on 2026-11-20 from drawn mockups (`docs/features/style-system/`: `round-2.html` plus PNGs; Nik's notes: Hardware and Liquid Glass look good, Rabbit and Nothing look good but their parts are far too big). Records: ADR 0003 and ADR 0004 at the end. Terms (vault glossary): **Style** = the design language (shapes, depth, borders, font, sizes; never colours, never layout); **Theme** = colour variations, pairs with any style; **Look** = one fixed way the kit draws a part; **Classic** = today's look, the default.

## Decided

- **Goal:** one branch, ready to merge, that lets the whole look change. Styles come only from Tavora at first; the format allows others later.
- **A style is data:** `styles/<name>/tavora.style.json`, schema-checked, no CSS or code. Picks one look per part and sets values. Never layout.
- **Parts and looks (first set):**
  | Part | Looks |
  |---|---|
  | Surfaces (app background, rail, top bar, panel) | flat · raised · glass · hairline |
  | Panel tab strip | pill · keycap · underline |
  | Panel content area | plain · inset screen |
  | Buttons | soft · keycap · capsule |
  | Inputs, checkboxes, switches | soft · inset · capsule |
  | Lists and selection | fill · inverted · accent bar |
  | Menus, popovers, dialogs | follow the surface look |
  | Labels, small headings | normal · small caps (letter spacing, optional mono) |
  | Status light | none · LED dot |
- **Values a style sets:** radius 0–16, border width, shadows, font (only bundled fonts), sizes within range: body text 12–15 px (13 today), control height 28–40 px (32 today), spacing 0.85–1.2×; out-of-range values are clamped.
- **Colours stay in themes.** Any style with any theme; each style's own themes are listed first; every pairing passes the contrast check. Glass surfaces are checked as the mixed colour, with a minimum opacity.
- **Settings:** Appearance gets a Style dropdown with previews at the top (show Nik a preview image before building). Font and corner radius become "Style default" plus override; radius range opens to 0–16. Panel style (Classic/Framed/Folders) stays, only inside Classic.
- **Default:** Classic = today's look.
- **Modules:** get the active style with the theme (`ui.getTheme` / `ui.theme`); kit controls follow it; modules may draw style-specific parts (optional). Older modules look Classic. The native panel corner radius (today a fixed 10 px in `module-view.ts` / `browser-view.ts`) follows the style.
- **Liquid Glass:** real glass on host-drawn parts (rail, top bar, tab strips, panel frames) over a soft colour field from the theme; panel content solid ([ADR 0004](#adr-0004-glass-on-host-chrome-only)).
- **Not in this branch:** Whiteboard (Excalidraw) and PDF pages keep their own look; the in-game overlay plates are untouched.
- **Ships:** Classic, Hardware (theme "Hardware": Light grey with red signal, Dark graphite with orange signal), Liquid Glass (theme "Glass": Light, Dark); Playground style + theme switcher with specimens for every look. **Also in this PR (Nik, 2026-11-20: "the whole system in one PR"):** Rabbit (hairline, underline tabs and fields, line buttons, bar lists, lowercase, thin numbers, Outfit, theme Rabbit) and Nothing (dotted, block tabs, line buttons, inverted lists, mono caps, dot-matrix numbers in Doto, theme Nothing), at normal size; own styles; Tavora's toasts follow the style.

## Contract between the halves (implementation, 2026-11-20)

Both the host/SDK work (step 1) and the kit work (steps 2–3) code against this. Change it only here, in the same commit as the code.

**Parts and looks** (`packages/sdk/src/protocol.ts`, exported):

```ts
export const STYLE_LOOKS = {
  surface: ["flat", "raised", "glass", "hairline"],
  tabs: ["pill", "keycap", "underline"],
  content: ["plain", "inset"],
  buttons: ["soft", "keycap", "capsule"],
  inputs: ["soft", "inset", "capsule"],
  lists: ["fill", "inverted", "bar"],
  labels: ["normal", "caps", "caps-mono"],
  status: ["none", "led"],
  numbers: ["normal", "dot", "thin"],   // added later: optional in a style file (first look then)
} as const;
// Added for Rabbit and Nothing: surface "dotted", tabs "block", buttons "line", inputs "underline", labels "lower".
export type StylePart = keyof typeof STYLE_LOOKS;
export type StyleLooks = { [P in StylePart]: (typeof STYLE_LOOKS)[P][number] };
export interface StyleValues {
  borderWidth: number;   // 0–2 px
  depth: number;         // 0–3 (none … strong), the kit maps it to shadows per look
  textSize: number;      // 12–15 px body text
  controlHeight: number; // 28–40 px
  spacing: number;       // 0.85–1.2 factor
  glassOpacity: number;  // 0.55–0.95, used by glass surfaces only
}
export interface TavoraStyle { id: string; name: string; looks: StyleLooks; values: StyleValues }
// TavoraTheme gains: style?: TavoraStyle   (missing = an older host: the kit uses Classic)
```

**Style file** `styles/<name>/tavora.style.json`: `{ id, name, description?, author?, version, looks, values, radius, font, themes? }`. `radius` (0–16) and `font` (a bundled `ThemeFont` id) are the style's defaults; `themes` lists theme ids shown first for this style. Validated like theme manifests: unknown keys, unknown parts or looks are errors; numbers outside the ranges are clamped (with a hint). Built-in ids: `tavora.classic`, `tavora.hardware`, `tavora.glass`.

**Resolving** (host main): the user's font and radius settings get a "style default" value (`null`). Final radius = user override ?? (style is Classic ? theme variation radius : style radius). Final font = user override ?? style font (Classic's font is Inter, so today's default stays). These land in the existing `TavoraTheme.radius` / `font`, so modules on an older kit still get the right corners and font. The saved settings must stay readable by the previous app version (add fields, don't rename).
- Saved (`library.json`, `main/library.ts`): `styleId` (left out for Classic, kept while not installed), `radius` (0–16, `null` = style default; a Tavora before styles reads 4–12 and uses the theme's for any other), `font` (left out = style default; `"inter"` is now kept as the user's own pick). Actions: `set-style { styleId }`, `set-radius { radius: 0–16 | null }`, `set-font { font: id | null }`; `reset-theme` also goes back to Classic.
- The host page gets, in `AppearanceView` (`shared/host-api.ts`): `styleId` (in use), `styles: StyleView[]` (`{ id, name, description, author, provenance, radius, font, themes, looks, values }`, Classic first), `radius` (override or `null`), `resolvedRadius`, `font` (in use, `{ id, family }`), `fontOverride` (id or `null`), `styleMarks` (what goes on `<html>`) and `styleProblems`.

**Applying** (SDK `bootstrap.ts` `applyHostTheme()` for modules, `renderer/theme.ts` `applyTheme()` for the host page), on `document.documentElement`:
- `data-style="<id>"` and `data-look-<part>="<look>"` for all eight parts
- CSS variables (prefixed so they never collide with Tailwind's own `--text-*`, `--spacing`, …): `--style-border-width: <n>px`, `--style-depth: <n>`, `--style-text: <n>px`, `--style-control-height: <n>px`, `--style-space: <factor>`, `--style-glass-opacity: <n>`
- With no `style` (older host), set nothing: the kit's CSS defaults are Classic. A theme without `style` after one with it removes them again.
- One list for both: the SDK's `styleMarks(style)` (`protocol.ts`); main sends it to the host page as `AppearanceView.styleMarks`. The first host with `style` is `STYLE_TAVORA` (0.24.107 now; re-check at merge).

**Classic values** (`styles/classic`): looks `surface flat, tabs pill, content plain, buttons soft, inputs soft, lists fill, labels normal, status none`; values `borderWidth 1, depth 1, textSize 13, controlHeight 32, spacing 1, glassOpacity 0.8`; radius 8; font `inter`. The kit half may correct these numbers so Classic stays pixel-identical; it says so in its commit.

**Inset content** (`looks.content = "inset"`): module panels (not web pages) get the colour tokens of the theme's dark variation when the active variation is light and the theme has a dark one (same contrast level preferred), so their content reads as a screen set into the light frame. The host draws the inset frame around the module view (dock CSS, kit half). `TavoraTheme.mode` then says `dark` for that module. With no dark variation, nothing changes.

**Glass contrast** (host main, `themes.ts` `glassProblems` / `glassOpacity`): with `looks.surface = "glass"`, the text pairs drawn on glass (on `rail`, `card`, `popover`) are measured on the mixed colour over the window background and the colour field's brightest spots (primary and info at 30 %, success and warning at 26 %, as `--style-field` in dock.css). The host raises the sent `values.glassOpacity` in 0.01 steps until all pass (at most 1, the solid colour the theme check already passed), so every style works with every theme and the kit never has to check. Tavora's own: Glass's themes keep 0.72; Garnet Dark goes to 0.83.

**Own styles** (2026-11-20, Nik: the whole system in PR #846): like own themes. The user's styles folder (`<userData>/styles`) loads as `local` styles after Tavora's own; `tavora.*` ids stay official-only. Settings > Appearance > Your styles: **New style** writes a copy of the style in use as `local.my-<name>` ("My Hardware", then "My Hardware 2") with a README, reloads and opens the folder; Open folder; Reload (reloads themes and styles together). Problems (unusable folders) and hints (numbers kept in range) show apart (`AppearanceView.styleProblems` / `styleHints`). Reference: `apps/docs/reference/style.md`. Tavora's own toasts get the style marks too (`ToastsLook.styleMarks`), and the settings search leaves Panel style out outside Classic.

**Native panel corners**: `main/panel-corners.ts` `panelCorners(style, panelStyle, radius)` gives `{ module, page, cover }` for module views, Browser pages and the loading cover. In Classic it returns today's values for every panel style (module 9, page 9, cover 10); in other styles the dock always draws Framed's frame with the body at `--radius`, so all three are the resolved radius (0 allowed) and the saved panel style is ignored. The host re-applies it when the theme, style, radius or panel style changes.

## Facts found (2026-11-20)

- 130 of 140 renderer `.vue` files use `@tavora/official-ui`; dock panels are `dockview-vue`, restyled via `--dv-*` in `dock.css`.
- Theme tokens are CSS variables set by `renderer/theme.ts` `applyTheme()` and, in modules, by SDK `bootstrap.ts` `applyHostTheme()` via `connectModule()`. One `--radius` drives kit corners; shadows, borders and several radii are Tailwind classes or literals (host ~23 shadows, 178 `rounded-*`; kit ~16 shadows, 81 `rounded-*`).
- No global density or text-size setting exists today.
- Module panels and Browser pages are native `WebContentsView`s placed over the host page; the host draws frames and tabs; views are opaque except over games.

## ADR 0003: styles are data

2026-11-20: A style is a data file (`styles/<name>/tavora.style.json`, schema-checked like themes) that picks one look per kit part (surfaces, tab strip, content area, buttons, inputs, lists, labels, status light) and sets values (radius 0–16, border width, shadows, a bundled font, sizes within a fixed range). It carries no CSS and no code. The kit draws every look; the host sends the active style to modules with the theme, and the kit applies it.

Alternatives: CSS per style inside the kit (most freedom, but every module bundles its own kit copy, so each new style would need every module rebuilt), or CSS shipped in a style package (others' CSS could hide or fake controls and slow the app). Data choices let a new style made of existing looks reach every up-to-date module without a rebuild, and let others make styles later without changing the security model.

Consequences: a look that doesn't exist yet (a knob, dot-matrix numbers) is a kit update with a Playground specimen, then styles can pick it. Modules built against an older kit show Classic. Styles never change layout, and sizes are clamped to the range (text 12–15 px, controls 28–40 px, spacing 0.85–1.2×).

## ADR 0004: glass on host chrome only

2026-11-20: In the Liquid Glass style, real glass (blur over a colour field from the theme) is only on what the host page draws: rail, top bar, tab strips and panel frames. A panel's content stays solid, because each module and web page is its own native view over the host page and cannot see or blur what is behind it.

Alternative: making module views transparent and letting modules paint a half-transparent background. It works mechanically (views already go transparent over games) but gives no blur, uneven text contrast and more chances of flicker, and every module would have to handle it.

Consequences: glass styles set a solid content surface; the contrast check measures glass surfaces as the mixed colour with a minimum opacity the style can't go below.
