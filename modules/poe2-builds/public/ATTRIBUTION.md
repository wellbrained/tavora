# Asset attribution

Path of Exile 2 passive tree data and artwork are copyright Grinding Gear Games.
Bundled tree data is derived from Path of Building Community PoE2 0.22.0,
TreeData/0_4 and TreeData/0_5. Passive sprites and background were assembled from
those local tree assets. Path of Building license and dependency notices accompany
this module in POB-LICENSE.md. No affiliation with Grinding Gear Games.

The module does not include third-party guide articles, user builds or example
character snapshots. Content loaded from a build file stays in the user's local
Tavora module documents.

Equipment artwork is copyright Grinding Gear Games, extracted from the local
Path of Exile 2 Steam installation (2026-10-18 snapshot). The compact English-name
catalogue maps base types and unique items to bundled WebP images. Development
extraction used pathofexile-dat and @poe2-toolkit/ggpk / item-extractor; those tools
are not module runtime dependencies. Flask artwork composites the game texture
layers. Unmatched items use the existing generic PoB slot icons.

Custom pixel gear placeholders and panel icons were generated for Tavora and
exported at UI sizes with transparent backgrounds. They are distinct from the
Grinding Gear Games item artwork; real item art has priority over placeholders.

Gem and ability artwork and optional decorative passive frames are copyright
Grinding Gear Games, extracted read-only from the local PoE2 installation
(2026-10-18 snapshot). English gem/identifier associations come from local
Path of Building Community PoE2 data. Class and ascendancy illustrations and
their native coordinates come from its 0.4/0.5 tree assets. All artwork is
bundled for offline use; unmatched gems retain attribute-coloured markers.

Item identity and equipment-class associations use local Grinding Gear Games
English data and Path of Building Community unique identifiers. Additional
small pixel-grid SVG placeholders extend the Tavora fallback set.

Affix metadata is cross-checked against Path of Building Community (PoE2) and
the HivemindOverlord/poe2-mcp data-v0.5.0-1 modifier dataset. Game data and item
assets remain copyright Grinding Gear Games. The MCP server is not installed
or required by this module; no network access is added.
https://github.com/HivemindOverlord/poe2-mcp
