# Settings for your module

Give your module's settings the same shape as Tavora's own modules, so users find their way around at once. They open in a dialog over Tavora, never inside the panel.

## Open them in a dialog

A settings button in your panel (a gear, at the end of the toolbar) calls `panel.openDialog`. Use the same size as every other module, so dialogs don't jump around:

```ts
settingsButton.addEventListener("click", () => tavora.panel.openDialog({ width: 960, height: 680 }));
tavora.panel.onDialogChange((open) => showSettings(open));
```

While the dialog is open your page is the dialog: show the settings instead of the panel's usual content. Tavora draws the frame with your module's name and a close button, so don't add a title bar or a close button of your own. When the settings are about one thing (a clock, a list), call `panel.setDialogTitle("Countdown")` once `onDialogChange` says the dialog is open, so the frame names it instead of the module (`null` goes back to the module's name; the next dialog starts with the name again). It needs Tavora 0.23.71: check `sdk.supports("panel.setDialogTitle")`, and show the name as a heading in the page on an older Tavora. Esc closes it as long as nothing inside (an open list, say) uses the key.

## Layout

- **Pages on the left, one column on the right.** A menu of 200 px lists the pages. Your module's own pages come first, without a heading. If your module has an overlay, **Overlays** follows under a heading set in a divider line. First how the overlay looks (**Text**, **Look**: your own pages, shared by game and stream), then where it shows: **In game** and **On stream**, each with a dot (green and filled: on, hollow: off). The menu entries are all `settingsMenu` gives you; what the **In game** and **On stream** pages hold is your module's own. Clock & Counter's **In game** page says whether the overlay is over the game and has an "Arrange in Overlays" link that opens Tavora's Overlay page with `overlay.openPage` (Tavora 0.23.77; leave such a link out where `sdk.supports("overlay.openPage")` is false). Build the menu with `settingsMenu` from the kit, so every module has the same order, icons and words.
- **Page top.** A title and one sentence on what the page changes. An overlay's on/off switch or main action goes right under it, in a bar of its own, so it's the first thing users see.
- **Preview.** Pages that change how something looks show it in a preview under the top, over a backdrop users can switch between a game-like scene, light and dark. It stays in place while the settings below scroll.
- **Rows.** Each setting is a row: its name (and a short hint if needed) on the left, the control on the right in a column 224 px wide, the same on every page, so controls line up. A control too wide for the column goes under the name instead. Related rows share a section with a small heading.
- **Last row.** A row that deletes something sits at the end of the page, with a red name and a destructive button (`SettingsRow danger`).
- **Footer.** "Reset this page" puts only the open page back to its defaults and offers Undo; pages with nothing to reset (hotkeys, a link) leave it out (`resettable`). Next to it, a note that changes save as you make them.

## Behaviour

- Every change applies and saves at once. There is no Save or Cancel button.
- Pick the control that shows the choice best: a switch for on and off, segments for two to five short options (XS to XL for a size), a list for more or longer ones, swatches for colours, a slider with its value for numbers (in steps that matter: 5 % for opacity is plenty).
- Keep labels short; they share the row with the control. Check them in every language you ship.
