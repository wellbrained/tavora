# Game icon provenance

Every icon here is original Tavora artwork: flat abstract symbols made from basic shapes. None copies a game's logo, title lettering or characters, and no publisher or store art is used.

Two sets, same ids as `apps/desktop/src/main/catalog.ts`:

- `tavora/` - Tavora's own look: muted warm tile, ivory and gold symbol.
- `classic/` - leans on each game's well-known colours and world (sky, ore, rings, ships) without reproducing its logo or characters.

## How they were made

The SVGs are written as code in `make-icons.ps1` (run it to regenerate both sets); the shapes are hand-composed by Claude (Opus/Sonnet 5.5 session of 2026-10-15) at the request of wellbrained. They were not drawn in VectorCraft or PhotoCraft. Canvas 256x256, full-bleed square (the app rounds the corners), previewed through headless Edge.

## Batch 1 (2026-10-15)

| id | tavora concept | classic concept |
|---|---|---|
| minecraft | isometric cube, ivory/gold | grass-topped dirt cube on sky |
| factorio | ivory gear | orange gear on grey with belt |
| valheim | gold longship | brown longship, red sail, night sky |
| elden-ring | broken gold ring | double gold ring and line on black |
| hollow-knight | blade in a pale ring | white blade with blue glow on dark |
| stardew-valley | sprout in soil | sprout, sun and field |
| rocket-league | ball with speed streaks | ball on blue/orange split |
| skyrim | snowy peaks and moon | grey peaks, snow caps, pale sky |
| satisfactory | hexagon with belt arrow | dark hexagon, orange belt arrow |
| terraria | pickaxe | tree, star and hill on sky |

Remaining ids are still to be drawn.
