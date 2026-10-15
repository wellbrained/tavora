# Tavora app icons

Square raster icons for app registrations and stores (for example the Discord developer portal, which asks for 1024×1024). They are rendered from the SVGs in [`../logo`](../logo), so regenerate them rather than editing the PNGs.

| File | Use |
| --- | --- |
| `tavora-emblem-dark-*.png` / `.jpg` | Main app icon. The emblem fits inside a circle, so it survives round crops such as Discord avatars. |
| `tavora-lockup-dark-*.png` / `.jpg` | Emblem and wordmark, for places that show the full square. Round crops cut off the wordmark. |
| `tavora-flame-dark-*.png` / `.jpg` | Flame only, for very small sizes such as favicons. |
| `tavora-emblem-transparent-*.png` | Emblem without background, only for dark surfaces (the flame swooshes are transparent). |

Each comes in 1024, 512 and 256 px. The dark background is `#1B1110`, the background of the approved original.

To regenerate (needs `resvg-py` and `Pillow`):

```sh
python make_icons.py ../logo .
```
