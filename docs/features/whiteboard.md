# Whiteboard

## Cards (2026-10-28)

Nik chose ordinary grouped Whiteboard objects rather than a dedicated card editor: keep cards freely editable, with no board migration or second editing model.

- Add card → Note card inserts a rectangle, heading and body at the current view's centre. Both card types are centred using their actual bounds and the current pan/zoom. Double-click text to edit it; standard grouping, ungrouping, sizing, styling, copy and Undo apply. Adding a card preserves earlier deletions in Undo history.
- Picture card opens a local PNG/JPEG/GIF/WebP. It inserts a fitted image, background and caption as one group. Images are decoded to a static PNG, at most 1440 px on the longest side, and stored by the existing file store. GIF cards use a still image. Input files above 20 MB are refused; unreadable images show a localized error without adding any card. Leaving the board during decoding cancels insertion.
- Picture cards stay movable after placement; ordinary pasted images still lock after placement for annotation. Locking a picture card locks its whole group so its caption and background stay with it.
- Individual image locks use neutral colours and show on image hover, selection or keyboard focus. The global lock action remains available.
- Narrow panels move image export/lock actions into Board actions and hide the drawing hint. Existing top/bottom toolbar preference remains.

All new text ships in English and German. Cards use the existing board document format and Excalidraw elements.
