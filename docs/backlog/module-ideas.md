# Module ideas backlog

Collected 2026-11-04. Already planned: Spreadsheet, Clock widget, Weather widget.
Already exist (don't repeat): Calculator, Clock & Counter, Notes, PDF Viewer, System Monitor, To-Dos, Whiteboard, AI Usage, Discord, Soundtrack, Sudoku, Word Guess, game modules.

## Parked: Input display (keys you press)

An overlay that shows a keyboard, a controller or both, with the keys you press lighting up. Could show the action ("Dodge") instead of the key ("Space") if the user names their keys.

- Needs a Tavora change: a native helper (keyboard, mouse, controller in the background), a new `input` connector with a yes prompt, an `input.changed` event in the SDK and protocol, a security page update, and maybe a keyboard/controller view in the UI kit.
- Open question: any module after a yes (like `media`) or Tavora's own modules only (like System Monitor's app list). Leaning: any module, keys only while the game is in front, only keys you picked or bound.
- Risks: works as a keylogger if done loosely; game chat shows on stream unless only bound keys show; anti-cheat and global hooks need testing.
- Ideas: compact mode (bound keys only), Xbox/PlayStation/Switch icons, mouse buttons and scroll, key heatmap after a session.

## Other ideas

- **Soundboard**: short clips on hotkeys, also on stream.
- **Screenshots**: your latest shots of the game, ready to look at or drop onto the Whiteboard.
- **Dice Tray**: dice and a coin for tabletop RPGs and board games.
  - Every die games use: d4, d6, d8, d10, d12, d20, d100 (two d10), Fate dice, and custom dice with your own faces.
  - Coin flip. No spin-the-wheel.
  - An overlay (over the game and in OBS) that shows the roll and the result.
  - An extremely smooth, good-looking dice animation.
  - Suggestions: roll text like `2d6+3`, advantage and disadvantage, saved rolls ("Fireball: 8d6"), a roll history, a hotkey to roll.
  - Tech notes: pick the result first with `crypto.getRandomValues`, then play an animation that lands on it, so it's fair and the panel and overlay can replay the same roll from one small message. WebAssembly is only for Tavora's own modules, so a catalogue module needs a pure-JS physics engine (for example three.js with cannon-es), not a WASM one.

## Dropped

- Now Playing (Soundtrack exists), Quick Links and Patch Notes (browser panels cover them), Session Log (just Notes without a game started/stopped event), Keybinds, Converter, Shopping List, Map Pins, Loadouts, Squad (not wanted).
