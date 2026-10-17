# Look and languages

Players pick Tavora's theme and language, and your module should follow both, so it looks and reads like part of the app.

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

All of them are listed under [Default look](../reference/protocol.md#default-look). They change by themselves when the player switches theme. Don't hard-code colours: players use dark and light themes and their own ones.

If you need the colours in script, for a canvas or a chart, ask the SDK:

```ts
import type { TavoraTheme } from "@tavora/sdk";

const paint = (theme: TavoraTheme) => drawChart({ line: theme.tokens.primary, grid: theme.tokens.border, dark: theme.mode === "dark" });
paint(await tavora.ui.getTheme());
tavora.ui.onThemeChange(paint);
```

`theme.tokens` has every colour by its shadcn-vue name (`background`, `primary`, `muted-foreground`, …), so a shadcn-vue or Tailwind project can set each one as `--<name>`. `theme.radius` is the corner radius in CSS pixels. How themes are made is in [Theme packages](../reference/theme.md).

## Fonts and pictures

Your page can't load anything from the internet, so bundle fonts and images with your build. Inter is already there as `var(--tavora-font-sans)` (and a monospace one as `var(--tavora-font-mono)`).

## Languages

Tavora is in English and German for now. Show your module in the player's language, or in English when you don't have it:

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

Store data in one language, not the player's: a default list named "To-Dos" keeps that name, and you show it translated. Then switching the language doesn't change what was saved.

## Shortcuts and size

- Tavora takes Ctrl+K (Cmd+K on macOS) for its own search before your page sees it. Choose other shortcuts.
- Panels can be narrow. Set `viewport.minWidth` and `minHeight` in the manifest to what your module really needs, and follow `tavora.workspace.onResize`.
- Pause timers and animations on `tavora.lifecycle.onSuspend` and start them again on `onResume`: a hidden panel shouldn't use the player's CPU while they play.
- Use `tavora.ui.showMenu` for menus, so they aren't cut off at your panel's edge and look like Tavora's own. See [Menus](../reference/protocol.md#menus).
