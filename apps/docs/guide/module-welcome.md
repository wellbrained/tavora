# A welcome for your module

A welcome greets users the first time they add your module and helps with the few choices that matter before they start: how much to spoil, bringing in their save, which panels to open. It is optional. Most modules don't need one: good empty states are enough. Add one when your module has a choice users should make before they see anything, or setup that's easy to miss.

The reference is Palworld's welcome (`palworld/src/Welcome.vue` in the modules repo). There is no kit component for it yet: build it from kit parts as below, so every welcome looks and behaves the same.

## When it shows

- **Once, right after Add.** Only a panel whose `panel.getLaunch()` answers `add` shows it, and only if the user hasn't seen it yet. A restore, a reload or a panel opened with `panels.open` or `panels.openMany` never shows it. When Add all adds several of your panels, only the last one, the one in front, may open the dialog; the others are refused like any late call.
- **The library steps aside.** When the welcome opens, Tavora closes the module library, so the welcome sits over the workspace.
- **In a dialog over the workspace.** Tavora lets a panel just added call `panel.openDialog()` once without a click, within 10 seconds of its page starting. Call it as soon as you know the user hasn't seen the welcome.
- **In the panel if the dialog is refused.** Over the game, on a Tavora older than this feature, or after 10 seconds, `openDialog` fails. Show the welcome in the panel's place instead, so it's never lost. With several panel types, Add all can leave copies of it in the panels behind the dialog: keep "seen" in a document then (see below), so every copy ends with it.
- **Seen means closed.** Skip, Esc, Done, Tavora's close button and your own close all count. There's no "remind me later".
- **Remember it where its choices live.** A module with one panel type and settings every workspace shares remembers it in `storage.app`, so the user sees it once. A module with several panel types, or whose steps change this workspace's data, keeps it in a document (like Palworld's settings document): every panel hears it change through `documents.onChange`, so a copy of the welcome in another panel ends too.
- **Existing users don't get it.** Their panels restore, so they never see an `add`. Offer it with **Show again** in your settings instead.

```ts
let welcoming = false;

const launch = await tavora.panel.getLaunch();
if (launch.reason === "add" && !(await tavora.storage.app.get<boolean>("welcomed"))) {
  welcoming = true;
  render(); // shows the welcome instead of the panel's content
  // Refused (over the game, an older Tavora, too late): the welcome stays in the panel.
  await tavora.panel.openDialog({ width: 640, height: 560 }).catch(() => undefined);
}

// Tavora's close button counts as seen too.
tavora.panel.onDialogChange((open) => {
  if (!open && welcoming) finishWelcome();
});

/** Skip, Esc and Done call this. */
function finishWelcome() {
  welcoming = false;
  void tavora.storage.app.set("welcomed", true);
  render();
  void tavora.panel.closeDialog().catch(() => undefined);
}
```

## Steps

- **One to four steps**, each about one choice or one action. If you need more, the module is asking too much up front.
- **Safe defaults first.** Everything works without the welcome: spoilers start hidden, nothing is imported, and the panel shows its usual empty state. Skipping must never leave the module in a worse state than finishing.
- **Nothing only here.** Every choice and action in the welcome is also somewhere else (settings, a toolbar menu, an empty state), and the step says where in one short line ("You can change this any time in Settings.").
- **Choices before content.** Put a choice that changes what users see (a spoiler level) first, so nothing shows before they decide. Put "open more panels" last, so the panels open with everything already set up.
- **Use your normal flows.** A step that imports a save opens the same import dialog as the menu, and afterwards says what came in ("Imported from Level.sav", the count). Opening panels uses `panels.openMany` (one click opens them all, laid out by your manifest's `panelLayout`), or one **Open** button per panel on older Tavora versions.
- **Name the panel the user is in** in an "open panels" step ("You're here") instead of an Open button.

## Look

- **Size**: `{ width: 640, height: 560 }` for every welcome, so they don't jump around. Tavora fits it into the workspace.
- **Top**: "Welcome · Step 1 of 3" in small muted text and a `Progress` bar under it.
- **Each step**: a title as a question or invitation ("How much do you want to see?", "Bring in your progress") and one short sentence. Then the choice (radio cards, a button, a list of panels) and, if needed, one muted line on where to find it later.
- **Footer**, with a line above it: **Skip** (ghost button) on the left on every step but the last; **Back** (outline, from step 2) and **Next** (primary) on the right; the last step's **Next** says **Done**.
- No title bar or close button of your own: Tavora's frame has the module's name and a close button.
- Kit parts only: `Progress`, `Button`, `RadioGroup`, `Badge`, `Notice`. Write the texts in English and German.

## Behaviour

- **Esc** ends the welcome like Skip, unless a list, menu or dialog inside it has the key (check `event.defaultPrevented` and whether the target is inside a `[role=listbox]`, `[role=menu]` or `[role=dialog]`), and not while a step's own dialog (an import) is open.
- **A click beside it doesn't close it.** Tavora keeps a welcome opened without a click open until the user closes it, so a stray click doesn't lose it.
- **Show again**: a row in your settings with a **Show again** button. Your settings already show in the dialog, so switch that dialog to the welcome; it ends like the first time.
- **Other panels** stay usable and show their content with the safe defaults while the welcome is open.

## Checklist

- [ ] Shows only for `add` and only when not seen; nothing after a restore, a reload or `panels.open`.
- [ ] Falls back to the panel when `openDialog` is refused.
- [ ] Every way out counts as seen, Tavora's close button included.
- [ ] One to four steps, each skippable, each choice also elsewhere.
- [ ] Defaults are safe without it.
- [ ] Show again in settings.
- [ ] Looked at in a dark and a light theme, in German, and in the panel at its minimum size (the fallback).
