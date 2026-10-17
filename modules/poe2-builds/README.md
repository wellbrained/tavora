# PoE 2 Builds alpha

Four native Tavora panel types: Tree, Skills, Gear, Guide. Requires Tavora 0.17.20+.

Build with `pnpm --filter @tavora/poe2-builds build`. Add this module folder under
Settings > Development, or install the signed module ZIP under Settings > Modules.
Add the four panel types from the module picker and arrange them in your workspace.

Choose **⋯ > Load build file** in any panel and select a `.tavora-build.json` exported
by the prototype. All panels share the library; their build/variant selections
stay independent. Buttons open another panel on the same build. Tree has pan,
zoom, search, red/green weapon sets and an ascendancy popover. Guide retains saved
wording and has a section navigator. The module makes no network requests.

Alpha 2 keeps the build and variant controls on one toolbar row. Other actions
are under **⋯**. Notes start collapsed; each note and **Show/Hide all notes** can
be toggled independently. Each panel remembers its weapon filter, passive search,
notes and Tree info visibility, as well as its build, variant and Guide section.
**Read in Guide** opens the matching section; local messages select one matching
Guide reader, using recent activity when several copies show the same build.
The compact Guide uses a section dropdown rather than a sidebar. This update uses
the same signing key and build-document format as alpha 1.

This alpha loads portable Tavora v1 JSON, not raw PoB XML, `.build` or ZIP files.
Convert those using the prototype first. No guides or personal builds ship in the
module. Builds auto-save through Tavora documents, scoped to this module/game.
A signed ZIP and a development folder have separate data by host design: load
the file again when changing between them.

The host blocks browser downloads, so build-file export is not offered in this
alpha. Keep original files as your portable copies. URL import adapters and a
host-supported export path are follow-up work. Guide text already in a loaded
file is retained completely; unimported prose is not reconstructed.

Files up to 24 MB are validated before saving. Large builds use revision-checked
headers plus immutable chunk documents under the host's 4 MiB limit. Replacements
commit the header last; failed writes keep the prior build. Superseded chunks are
reclaimed after commit; readers retry a changed header. Host limits (50 MiB total,
1000 documents) still apply. A crash while staging chunks can leave unreferenced
chunks; automatic recovery/cleanup is a follow-up limitation of this alpha.

Tree data and artwork: Grinding Gear Games, sourced from Path of Building
Community PoE2 tree versions 0.4/0.5. Bundled Path of Building notices are in
`dist/POB-LICENSE.md`. No affiliation with Grinding Gear Games. No DPS calculations,
live character sync, build editing or game validation. Unresolved allocated node
IDs are counted in Tree info; no alternate tree version is silently substituted.

`test/serve.py` provides a localhost SDK bridge smoke-test harness on port 4190.
It is not the real Tavora runtime and is excluded from module ZIPs. It persists
its test data separately in that browser origin. Core tests run with
`pnpm exec vitest run modules/poe2-builds/src/core.test.ts` from the repository root.
