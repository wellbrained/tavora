# Module ideas backlog

Collected 2026-11-04. Already planned: Spreadsheet, Clock widget, Weather widget.
Already exist (don't repeat): Calculator, Clock & Counter, Notes, PDF Viewer, System Monitor, To-Dos, Whiteboard, AI Usage, Discord, Soundtrack, Sudoku, Word Guess, game modules.

## Parked: Input display (keys you press)

An overlay that shows a keyboard, a controller or both, with the keys you press lighting up. Pairs with Keybinds: show the action ("Dodge") instead of the key ("Space").

- Needs a Tavora change: a native helper (keyboard, mouse, controller in the background), a new `input` connector with a yes prompt, an `input.changed` event in the SDK and protocol, a security page update, and maybe a keyboard/controller view in the UI kit.
- Open question: any module after a yes (like `media`) or Tavora's own modules only (like System Monitor's app list). Leaning: any module, keys only while the game is in front, only keys you picked or bound.
- Risks: works as a keylogger if done loosely; game chat shows on stream unless only bound keys show; anti-cheat and global hooks need testing.
- Ideas: compact mode (bound keys only), Xbox/PlayStation/Switch icons, mouse buttons and scroll, key heatmap after a session.

## Other ideas

- **Keybinds**: your own cheat sheet of each game's controls, with an in-game overlay. Possible as a community module today. Top pick.
- **Soundboard**: short clips on hotkeys, also on stream.
- **Converter**: units, currencies and time zones, next to Calculator.
- **Screenshots**: your latest shots of the game, ready to look at or drop onto the Whiteboard.
- **Dice & Picker**: dice, coin flip, spin the wheel.
- **Shopping List**: materials you still need for a build or craft.
- **Map Pins**: pins on any map image you have.
- **Loadouts**: save and compare gear, skill or deck setups.
- **Squad**: who you play with, their times and roles.

## Dropped

- Now Playing (Soundtrack exists), Quick Links and Patch Notes (browser panels cover them), Session Log (just Notes without a game started/stopped event).
