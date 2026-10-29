# Look and languages

Users pick Tavora's theme and language, and your module should follow both, so it looks and reads like part of the app.

## The default look

Before your page renders, Tavora adds a stylesheet below everything you write: no page margin, the theme's background and text colour, Inter at 14 px, buttons, fields and scrollbars in the theme, a focus ring and sized headings. A page that styles nothing already fits in. Any rule of your own wins over it.

## Use the theme's colours

The same stylesheet defines the theme's colours as CSS variables, so your CSS can use them without any code:

```css
.card {
  background: var(--tavora-card);
  color: var(--tavora-foreground);
  border: 1px solid var(--tavora-border);
  border-radius: var(--tavora-radius);
}
.card button.main {
  background: var(--tavora-primary);
  color: var(--tavora-primary-foreground);
}
.hint {
  color: var(--tavora-muted-foreground);
}
```

All of them are listed under [Default look](../reference/protocol.md#default-look). They change by themselves when the user switches theme. Don't hard-code colours: users use dark and light themes and their own ones.

If you need the colours in script, for a canvas or a chart, ask the SDK:

```ts
import type { TavoraTheme } from "@tavora/sdk";

const paint = (theme: TavoraTheme) => drawChart({ line: theme.tokens.primary, grid: theme.tokens.border, dark: theme.mode === "dark" });
paint(await tavora.ui.getTheme());
tavora.ui.onThemeChange(paint);
```

`theme.tokens` has every colour by its shadcn-vue name (`background`, `primary`, `muted-foreground`, …), so a shadcn-vue or Tailwind project can set each one as `--<name>`. `theme.radius` is the corner radius in CSS pixels, and `theme.toasts` is where the user wants toasts (the shared kit's Toaster follows it by itself). How themes are made is in [Theme packages](../reference/theme.md).

## Fonts and pictures

Your page can't load anything from the internet, so bundle fonts and images with your build. Inter is already there as `var(--tavora-font-sans)` (and a monospace one as `var(--tavora-font-mono)`).

## Languages

Tavora is in English and German for now. Show your module in the user's language, or in English when you don't have it:

```ts
const texts = { en: { add: "Add step" }, de: { add: "Schritt hinzufügen" } };
const pick = (language: string) => texts[language as keyof typeof texts] ?? texts.en;

let t = pick(await tavora.ui.getLanguage());
render();
tavora.ui.onLanguageChange((language) => {
  t = pick(language);
  render();
});
```

Store data in one language, not the user's: a default list named "To-Dos" keeps that name, and you show it translated. Then switching the language doesn't change what was saved.

Your module's name, description and panel names come from the manifest. Add [`translations`](../reference/manifest.md#translations) to show them in the user's language too.

## Shortcuts and size

- Tavora takes Ctrl+K (Cmd+K on macOS) for its own search before your page sees it. Choose other shortcuts.
- Panels can be narrow. Set `viewport.minWidth` and `minHeight` in the manifest to what your module really needs, and follow `tavora.workspace.onResize`. A module that looks different when wide can set a second minimum for that, see [Tall and wide](#tall-and-wide).
- Pause timers and animations on `tavora.lifecycle.onSuspend` and start them again on `onResume`: a hidden panel shouldn't use the user's CPU while they play.
- Use `tavora.ui.showMenu` for menus, so they aren't cut off at your panel's edge and look like Tavora's own. See [Menus](../reference/protocol.md#menus).

## Tall and wide

A panel may be docked tall and narrow or wide and low. When your module has a layout for each, say a grid above its controls and a grid beside them, give each its own minimum:

```json
"viewport": { "minWidth": 320, "minHeight": 440, "wide": { "minWidth": 500, "minHeight": 300 } }
```

- `minWidth` and `minHeight` hold while the panel is taller than wide or square, `wide` while it is wider than tall. Tavora never lets the panel go below the one for its shape.
- Where your panel can't take the other layout yet, a resize stops at square instead. A panel 450 high in the example above stops at 450 wide: at 451 it would be wide but narrower than 500. Make it taller first.
- Switch the layout in CSS: `@media (orientation: landscape)` is true exactly while your panel is wider than tall. A container query on your page's root works too. There is no call to make.
- Leave `wide` out and one minimum applies to every shape, as before. A module that only has a wide layout just sets a wide minimum, such as `"minWidth": 500, "minHeight": 300`.
- A panel type with its own `viewport` sets its own `wide`.

Needs Tavora 0.21.94 or newer, so set `minTavora` to a version newer than `0.21.93`.
