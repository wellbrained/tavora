# PoE 2 Builds alpha

Four native Tavora panel types: Tree, Skills, Gear, Guide. Requires Tavora 0.19.3+.

Build with `pnpm --filter @tavora/poe2-builds build`. Add this module folder under
Settings > Development, or install the signed module ZIP under Settings > Modules.
Add the four panel types from the module picker and arrange them in your workspace.

Choose **Add > Load build file** in any panel and select a `.tavora-build.json` exported
by the prototype. All panels share the library; their build/variant selections
stay independent. Buttons open another panel on the same build. Tree has pan,
zoom, search, red/green weapon sets and an ascendancy popover. Guide retains saved
wording and has a section navigator. Character import and Refresh use Tavora's
network permission for `poe.ninja`; viewing saved data and PoB imports work offline.

Alpha 2 keeps the build and variant controls on one toolbar row. Other actions
are under **⋯**. Notes start collapsed; each note and **Show/Hide all notes** can
be toggled independently. Each panel remembers its weapon filter, passive search,
notes and Tree info visibility, as well as its build, variant and Guide section.
**Read in Guide** opens the matching section; local messages select one matching
Guide reader, using recent activity when several copies show the same build.
The compact Guide uses a section dropdown rather than a sidebar. The build-document
format remains compatible with alpha 1.

**Load build file** accepts portable Tavora v1 JSON. **Import character** accepts
PoB PoE2 XML or a direct export code (not a pobb.in/Pastebin link), and public
`https://poe.ninja/poe2/builds/<league>/character/<account>/<character>` URLs.
Planner `.build` and ZIP files can be attached under **Import build**. No guides or personal builds ship in the
module. Builds auto-save through Tavora documents, scoped to this module/game.
A signed ZIP and a development folder have separate data by host design: load
the file again when changing between them.

**⋯ > Export build** (alpha 24) saves the open build or character as
`<name>.tavora-build.json` in Downloads/Tavora through the host's JSON export, which
**Load build file** reads back. It keeps the guide text and the original source
document. Tavora 0.20.7 and older accept at most 1 MiB, which large Mobalytics
guides exceed; newer hosts accept 8 MiB. Guide text already in a loaded file is
retained completely; unimported prose is not reconstructed.

### Guide import (alpha 20)

Choose **Add > Import build** and paste a public Mobalytics PoE 2 build URL.
All available variants and original guide text are read locally without AI. If a
normal request cannot read the public page, Tavora uses an isolated hidden browser
with no player cookies or sign-ins. Verification/login pages stop the import.
Preview the name, variants, chapters and warnings, then save as new or explicitly
update an existing guide. The source-selected variant opens first. **Update guide**
under ⋯ fetches a new preview; nothing refreshes automatically.

An optional planner ZIP, .build, PoB XML or Tavora file provides a fallback when
the page is unavailable. Attachments without guide text cannot recreate that text.
ZIP imports never extract files; compressed size, expansion, entry count and CRC
are checked. Original text, variant association, Quest Rewards and a public-only
planner snapshot are saved for offline use. Unresolved affix tiers and socketed
augment effects remain in source data and are not guessed.
Updating matches variants by the guide's own variant ID, then by exact name, never
by position. The preview lists new, changed and removed variants; removing needs
**Save and remove**. The variant you had open stays open when the guide still has it.
The preview names the adapter version and the game patch it supports (Mobalytics
adapter 2, patch 0.5), and counts what the guide keeps but Tavora doesn't show yet,
such as attribute picks and soul cores, or what the guide leaves open.

Tests run against eight public Mobalytics guides in `test/fixtures/mobalytics`,
made with `tools/mobalytics-fixture.mjs`: real structure and game data, but the
authors' prose is swapped for placeholder words because this repository is public.

Website access now includes mobalytics.gg and cdn.mobalytics.gg, alongside poe.ninja.
An update asks for these new domains before using them.

### PoE Vault guides (alpha 23)

**Import build** also reads PoE Vault guide URLs (`www.poe-vault.com/poe2/<class>/<ascendancy>/<guide>`)
with plain requests, no hidden browser. The page gives the article and its planner links. Saved
passive trees load through the public planner's own read action (`loadPassiveTreeBuild`); its ID
changes with each site release, so the adapter reads it from the planner's scripts and retries once
when it goes stale. Gem planner links are Brotli-compressed JSON, decoded with the bundled `brotli`
decoder (`dist/BROTLI-LICENSE.txt`), because Chromium's DecompressionStream has no Brotli.

Gems are Icy Veins index numbers whose meaning changes between planner versions.
`tools/poevault-gems.mjs` builds `src/poevault-gems.json` from the planner's own version list,
sharing one table between versions that number gems alike. A planner version without a table is
left out with a note; rerun the tool when PoE Vault adds one. Gems resolve by game ID, then by exact
name and kind. Unknown numbers are counted, never guessed.

PoE Vault doesn't link trees to gem setups. Setups with the same name become one variant; the rest
stay separate and list only in Tree or Skills (the same mechanism as PoB character profiles). Variant
names are the only identity the site gives, so updates match by name; repeated names get a number.
There is no gear planner: gear stays empty and the preview says so. Old hash-only tree links (patch
0.4) and attribute picks are counted in the import notes. The adapter is "PoE Vault adapter 1 · patch 0.5".

Tests use nine public guides in `test/fixtures/poevault`, made with `tools/poevault-fixture.mjs`:
real planner data, headings and inline game names, placeholder prose. Live check:
`POE2_POEVAULT_SMOKE_URL` in `apps/desktop/test/e2e/guide-import.spec.ts`.

### Character import (alpha 18)

Choose **Add > Import character** from any panel. The labelled Add button stays
visible before the build selector. Add and panel actions use icon-led rows with
short descriptions; an empty library shows the add actions directly. **Import
build** reads Mobalytics and PoE Vault guide URLs and offers an optional file fallback.
Preview the character, edit its
name if needed, then choose **Import as new** or an existing character to update.
Characters appear under **My characters**, separate from **Guide builds**, with
class, level and import time. They are saved locally and survive restarts.
**Refresh character** retrieves a linked poe.ninja snapshot and asks you to save
it. Updates use the same atomic storage path as build loading; a failed fetch,
parse or write leaves the saved character intact. There is no automatic refresh,
account login, comparison calculation or snapshot-history UI in this release.

PoB's independently selected equipment, skill and tree profiles open as **Active
setup**. Each panel can select its other relevant profiles without mixing all
sets together; the chosen weapon set, gem levels and quality travel with them.
Supported passive trees are 0.4 and 0.5; unsupported trees are rejected. XML and
expanded export codes are capped at 8 MB; saved characters at 24 MB. XML document
types/entities are refused. Importing runs locally without AI or a Python helper.

poe.ninja can lag behind the game. Exact item properties, requirements, rarity,
modifier sections/IDs and quest bonuses are retained where provided. PoB may
contain planned gear; it is not proof of current in-game equipment. Missing
properties/affix tiers are not guessed. Full PoB calculation/configuration
rendering is not yet available. Artwork uses the bundled catalogue with existing slot placeholders.
PoB source XML and additive character metadata survive portable-v1 validation.

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

Alpha 3 restores the preview presentation: gem markers, fully coloured support
badges, gear slot icons and rarity badges. Ascendancy/search float over the tree;
Tree info and zoom sit at the bottom, with red/green weapon-set buttons below.
Actual gem levels are preserved when supplied. Character level ranges remain
labelled separately; missing gem levels are shown as unavailable. Existing builds
and saved panel preferences remain compatible.

Alpha 4 adds the approved character equipment view above the detailed Gear list.
Show/Hide inventory and equipment weapon-set selection are remembered per panel.
Hover/focus a slot for stats; click or press Enter to pin them, Escape to close.
Missing slots remain empty, including missing swap weapons. The layout contains
equipped gear only, with no backpack. Source files using repeated flask/charm slots
and numbered slots are supported. Alpha 4 used generic PoB slot artwork. The details list uses two columns from 680px of panel width, one below.

Alpha 5 adds bundled game artwork to inventory slots and the detailed Gear list.
Unique items match by name; crafted rare/magic items match by base type. Unknown
items retain slot icons. Artwork is local: no image hosts, game installation or
network access are needed at runtime. Existing builds and panel state still work.

Alpha 6 adds collapsible Guide chapters and a hideable chapter sidebar. Panels
up to 640px wide automatically use dropdown navigation; chapter navigation opens
the destination. Individual/all chapter visibility and the wide-panel sidebar
preference persist. Original guide wording stays unchanged. Additional chapters
expose saved skill/equipment details, build information, import notes and video
or distinct variant references when available. Gem quality is retained when
supplied. Chapters are derived from the portable file's data, so existing files
need no migration. Absent values and lost inline references are not reconstructed.

Alpha 7 includes distinctive Tree/Skills/Gear/Guide tab icons and custom pixel
placeholders for bow, helmet, rings, health and mana flasks. Actual item artwork
still wins; empty slots show dim placeholders. Health is red, mana is blue.
Variant-specific saved guide notes are retained without falling back to a
different variant. Existing damaged guide text needs a corrected portable file;
the module cannot recover words absent from its local file. The development
tools/mobalytics_snapshot.py utility converts explicitly captured rendered guide
snapshots deterministically, preserving inline labels and checking variant tabs.
It is not a URL importer and is excluded from the installable ZIP.

Alpha 8 adds offline artwork for active, support and socketed skill gems. Exact
English names and PoB identifiers resolve to compact bundled atlases; unknown
gems retain attribute-coloured markers. Actual levels and lineage badges remain.
Native class illustrations sit at the main tree centre; the ascendancy popover
shows its matching illustration, using version-specific coordinates. Tree info
contains an optional **Decorative frames** checkbox, remembered per panel and
applied to both tree views. It starts off so the previous styling is preserved;
weapon-set allocation rings keep their red/green colours in either mode.
Existing portable files need no replacement or reimport for the artwork.

Alpha 9 simplifies Tree info to unique Total / Set 1 / Set 2 node counts. Shared
nodes contribute to Total only; a node used in both weapon sets counts once in
Total. Decorative frames and zoom-dependent allocated notable/keystone names
have remembered checkboxes in the weapon-allocation bar.
Gear has independent inventory and equipment-list visibility controls, known
rarity borders/badges, and no missing-rarity label. Item-specific saved notes
appear after stats and before the pin hint. The inventory backdrop is static
CSS, requiring no extra image load.
Guide navigation groups chapters into General and build variants, with short
chapter tabs. Narrow panels use a group dropdown; the wide group sidebar can
also be hidden. Chapter collapse, keyboard tab navigation and contextual jumps
remain supported; contextual links select the matching variant. Generated Skill
details, Equipment details and Import notes chapters are removed; original
author chapters and all underlying saved data remain intact. Older files encode
variant membership in chapter-title suffixes; unmatched chapters stay in General.

Alpha 10 omits missing gem-level messages, abbreviates gem tooltip attributes
(for example Maim (Dex)), and puts character-level badges beside skill names.
Known actual gem levels remain visible. Support names are slightly larger.
General Gear notes open by default in a fixed bottom section; their collapse
choice and Show/Hide all notes still work. Equipment scrolls independently, and
item-specific notes remain beneath item stats in the list and inventory tooltip.
Guide web addresses are clickable through Tavora's normal link API: use an
existing game Browser panel, otherwise show the host destination dialog. The
current SDK cannot force that dialog with Ctrl-click; that requires a host/SDK
extension. No direct window navigation or external-browser workaround is used.

Alpha 11 uses a 64px active gem column and 24px support icons beside each skill.
Gear uses slot section headings, level badges and bulleted modifier lists. Its
minimum viewport is 400 × 608px, sized to keep the inventory visible with default
Gear notes open; the preferred width is 568px. Inventory and list visibility stay
independent at every width. Lists use two columns from 800px. Guide chapters use
flat underline tabs; Tree allocation controls use 14px text.

Alpha 12 resolves saved planner item/base IDs using bundled English game and
PoB name tables. Planner labels remain source metadata. Every equipment slot
has a custom fallback; weapon labels/icons follow each equipped weapon set.
Two-handed weapons reserve the offhand, while bows permit a quiver. Item hover
details wrap without scrollbars. Existing saved builds resolve on load.

Alpha 13 preserves extended item properties, requirements and affix metadata in
portable v1 files. Item level and quality are name badges; requirement values
align beneath artwork. Modifiers show prefixes before suffixes with right-edge
type/tier badges, inline crafted/fractured labels, connected hybrid lines and
socketed effects last. No prefix/suffix headings are shown. Unique modifiers do
not receive ordinary affix tiers; ambiguous guide targets retain unnumbered P/S.
An exact-content catalogue enriches recognized older exports, without applying
facts to modified or unrelated items. Updated files retain all guide chapters.
Equipment order is fixed across builds. Plain visibility/ascendancy switches,
dropdown indicators, collapse icons, frame-label help and wrapping Guide tabs
clarify control behavior. Quest rewards display saved author advice or recorded
character choices separately. Build selectors put the build name before source.

Alpha 14 reissues the Alpha 13 item-details and control improvements under a
new version so installations already on Alpha 13 can update normally.

Alpha 15 fixes a document overflow caused by visually hidden rarity labels outside
an item-positioning context. Gear now has one equipment scrollbar with no blank
page tail. Inventory tooltips use a wider, left-aligned layout and expand further
when needed to reduce wrapping, while retaining the viewport width limit.

Release ZIPs are signed with the **WellBrained publisher key**, fingerprint
`2b85409d347617c9b8fe014fae1d90ec`. Always pass the publisher key explicitly with
`--key` when running `tavora-pack`; stop if it cannot be read. Never fall back to
a generated key or use `catalogue-key.pem`. The expected signature `publicKey` is
`hAitBzxq+BAxvvMXD6mgIJqHcXOtNIl2qMaeyBy43FE=`. Earlier alpha ZIPs signed with
another publisher identity must not be used as the signing reference.

Alpha 16 anchors inventory hover details below the mouse and follows pointer movement
within a slot. At the bottom edge it prefers above the pointer, with placement
constrained to the panel. Clicking freezes the details; keyboard focus anchors
below the equipment slot. Alpha 15's sizing and scrollbar repairs are retained.

Alpha 17 uses Tavora's shared item tooltip surface above neighbouring panels.
Details prefer the pointer's right side, then left, within the app window. Click
pins one item until Escape, close or another pin; hovering cannot replace it.
Changing builds, hiding/closing Gear, changing games or leaving Tavora dismisses it.
Underlying panels remain live. Requires Tavora 0.18.18 and SDK 0.2.8.

### Tree jewels (alpha 27)

A passive socket holding a jewel draws the jewel's bundled art. Hovering it opens the
same host item tooltip as Gear; a click pins it, Escape or a click elsewhere closes it.
Gear lists the jewels under **Jewels** after the equipment, never on the doll, for the
tree that belongs to the variant shown (a character's active tree).

Jewels belong to a tree: `stage.jewels` holds items with `inventory_id: 'Jewel'`,
`node` (the socket's passive ID) and `slot_x` (their order). PoB reads
`<Sockets><Socket nodeId itemId>` per tree spec; poe.ninja swaps in its own copy of
each jewel by Unique ID, like equipment. Mobalytics gives `passiveTree.jewels` per
variant with slugs but no rolls: rare mods resolve their game mod IDs through
`src/mod-texts.json` (`node tools/mod-texts.mjs <PoB folder>`, from PoB's ModJewel and
ModItem) as labelled PoB ranges; uniques use `unique-references.json`. Uniques whose
mods PoB generates from a pool (Heart of the Well, Against the Darkness) have no
reference. What doesn't resolve is marked `modsMissing` and shown as "The guide
doesn't give its mods". Radius and timeless effects on nearby nodes are not shown.
Files without jewels load as before.
