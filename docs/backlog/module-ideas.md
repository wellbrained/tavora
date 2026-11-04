# Module ideas backlog

Collected 2026-11-04. Already planned: Spreadsheet, Clock widget, Weather widget.
Already exist (don't repeat): Calculator, Clock & Counter, Notes, PDF Viewer, System Monitor, To-Dos, Whiteboard, AI Usage, Discord, Soundtrack, Sudoku, Word Guess, game modules.

## Parked: Input display (keys you press)

An overlay that shows a keyboard, a controller or both, with the keys you press lighting up. Could show the action ("Dodge") instead of the key ("Space") if the user names their keys.

- Needs a Tavora change: a native helper (keyboard, mouse, controller in the background), a new `input` connector with a yes prompt, an `input.changed` event in the SDK and protocol, a security page update, and maybe a keyboard/controller view in the UI kit.
- Open question: any module after a yes (like `media`) or Tavora's own modules only (like System Monitor's app list). Leaning: any module, keys only while the game is in front, only keys you picked or bound.
- Risks: works as a keylogger if done loosely; game chat shows on stream unless only bound keys show; anti-cheat and global hooks need testing.
- Ideas: compact mode (bound keys only), Xbox/PlayStation/Switch icons, mouse buttons and scroll, key heatmap after a session.

## Parked: Screenshots and clips

Only worth it if Tavora records its own screenshots and clips. Just gathering shots from other tools isn't worth a module.

- Shots by hotkey are cheap: Tavora already grabs a game window (layout pictures) and has global hotkeys. A game in exclusive fullscreen can come out black. But Steam (F12), Game Bar and NVIDIA already do this for free.
- Clips ("save the last 30 seconds") need a native recorder: capture, the GPU encoder on NVIDIA, AMD and Intel, game sound plus mic, a rolling buffer, MP4. Exclusive fullscreen needs hooks that anti-cheat may block. That's weeks of work plus upkeep, and it would trail free tools (Game Bar, NVIDIA App, AMD Adrenalin, Steam Game Recording, OBS replay buffer, Medal) for a long time.
- What only Tavora could add: clips sorted by game workspace, dropping them on the Whiteboard, showing them in the overlay. Not enough to make up for the cost.
- Revisit if Tavora gets its own native capture for another reason.

## Other ideas

- **Sounds** (one module, two panel types that share one sound library):
  - **Soundboard**: short clips on hotkeys, also on stream.
  - **Ambience**: looping rain, tavern or dungeon sounds in layers, each with its own volume, for tabletop nights or focus.
  - Gapless loops with Web Audio (`loop = true` on a decoded buffer) plus a short crossfade. Test that sound keeps playing while the panel is hidden.
  - Sounds: generate rain, wind, fire and noise in code; the rest from CC0 (Freesound, OpenGameArt) with a credits file. Avoid NonCommercial, Sonniss and Pixabay (no redistribution as files).
  - Own sounds need a new Tavora file call; modules can only open JSON today.
- **Dice Tray**: dice and a coin for tabletop RPGs and board games.
  - Every die games use: d4, d6, d8, d10, d12, d20, d100 (two d10), Fate dice, and custom dice with your own faces.
  - Coin flip. No spin-the-wheel.
  - An overlay (over the game and in OBS) that shows the roll and the result.
  - An extremely smooth, good-looking dice animation.
  - Suggestions: roll text like `2d6+3`, advantage and disadvantage, saved rolls ("Fireball: 8d6"), a roll history, a hotkey to roll.
  - Tech notes: pick the result first with `crypto.getRandomValues`, then play an animation that lands on it, so it's fair and the panel and overlay can replay the same roll from one small message. WebAssembly is only for Tavora's own modules, so a catalogue module needs a pure-JS physics engine (for example three.js with cannon-es), not a WASM one.

## Dropped

- Now Playing (Soundtrack exists), Quick Links and Patch Notes (browser panels cover them), Session Log (just Notes without a game started/stopped event), Keybinds, Converter, Shopping List, Map Pins, Loadouts, Squad (not wanted).
