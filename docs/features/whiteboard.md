# Whiteboard

## Cards (2026-10-28)

Nik chose ordinary grouped Whiteboard objects rather than a dedicated card editor: keep cards freely editable, with no board migration or second editing model.

- Add card → Note card inserts a rectangle, heading and body at the current view's centre. Both card types are centred using their actual bounds and the current pan/zoom. Double-click text to edit it; standard grouping, ungrouping, sizing, styling, copy and Undo apply. Adding a card preserves earlier deletions in Undo history.
- Picture card opens a local PNG/JPEG/GIF/WebP. It inserts a fitted image, background and caption as one group. Images are decoded to a static PNG, at most 1440 px on the longest side, and stored by the existing file store. GIF cards use a still image. Input files above 20 MB are refused; unreadable images show a localized error without adding any card. Leaving the board during decoding cancels insertion.
- Picture cards stay movable after placement; ordinary pasted images still lock after placement for annotation. Locking a picture card locks its whole group so its caption and background stay with it.
- Individual image locks use neutral colours and show on image hover, selection or keyboard focus. The global lock action remains available.
- Narrow panels move image export/lock actions into Board actions and hide the drawing hint. Existing top/bottom toolbar preference remains.

All new text ships in English and German. Cards use the existing board document format and Excalidraw elements.

## Default card styles (2026-10-29)

New note and picture cards use coordinated warm paper/stone fills, a shared 1 px border and 8 px corners. Note headings are 24 px, bodies 17 px with more line spacing, and picture captions 16 px. Picture cards have 12 px image padding. Colours are stored in the scene and follow Excalidraw's light/dark rendering; the normal style palette remains available. Existing cards and drawings are not restyled.

## Connectors and starter boards (2026-10-29)

Nik chose a type-and-drag Connect menu and three starters under New board.

- **Connect:** Line, One-way arrow and Two-way arrow use Excalidraw's native arrow tool, including attachment to cards. A line is a connector with no arrowheads, so it still attaches. With an existing unlocked connector selected, the menu changes its arrowheads without replacing its geometry or bindings. Activation waits for the menu to close before giving focus to the canvas.
- **Blank** starts an ordinary empty board. The first automatically created board is still blank.
- **Idea board** starts three editable note cards and two attached one-way connectors. Each new starter has its own document and name; existing boards are untouched.
- **Screenshot annotation** asks for a local PNG/JPEG/GIF/WebP before creating anything. It uses the same 20 MB input limit and 1440 px static-image preparation as picture cards, then starts a board with the image locked for drawing over it. Cancelling or an unreadable image creates no board.
- Newly created Idea and Screenshot boards fit their contents into the panel once. Their saved views then retain pan and zoom normally.
- **Show grid** in the board menu is off by default, saved per board, and restored with it. The optional `grid` field extends version 1 documents; older boards read it as false and need no migration.

Panel preferences remain plain objects so selected board, palette and viewport can cross the message bridge. Each view's save function retains its own board ID and revision; a closing view cannot flush into the next board during a fast switch.
