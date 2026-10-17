# Tavora logo (vector)

Vector versions of the approved Tavora logo, traced from the approved 1254×1254 raster. They are plain SVG: only paths and linear gradients, with no embedded images, fonts, filters or scripts.

| File | viewBox | Contents |
| --- | --- | --- |
| `tavora-master.svg` | `0 0 1254 1254` | Full logo on the original square canvas |
| `tavora-lockup.svg` | `157 200 939 825` | Emblem and wordmark, cropped |
| `tavora-emblem.svg` | `346 218 557 603` | Campfire emblem: ring, sparks, flame and stones |
| `tavora-wordmark.svg` | `157 792 939 233` | TAVORA lettering |
| `tavora-flame.svg` | `435 346 384 384` | Flame only |

The cropped files keep the original coordinates in their `viewBox`, so all five line up exactly when overlaid.

Usage notes:

- The dark swooshes inside the flame are transparent, so the logo only reads correctly on dark backgrounds. Never recolour, stretch or outline it, and never place it on a light background.
- This is a measured approximation of the raster, not a pixel copy. Edges stay within 1 px of the original, and the average color error is under 1 level per RGB channel. resvg and Cairo render it with small antialiasing differences.
- Each stone has two faces split by one curved crease, plus a thin highlight along its top edge. This layout was approved on 2026-10-14.

The build script, measurements and comparison images for this version (v1.2) are kept with the brand source files outside this repository.
