# Game data

`src/data/game-data.json` holds the items, production recipes, buildings, unlocks and progress (Space Elevator phases, milestones, MAM research, hard drives) the module ships. It is extracted from a local Satisfactory install and pinned to one build:

- Game version 1.2.4.1, Steam build 25782416 (public branch).

`src/data/sample.ts` is a small hand-made set in the same shape for tests.

## Sources

All data comes from files in the game install:

- `CommunityResources/Docs/en-US.json` and `de.json`: items, recipes, buildings, schematics, with English and German texts. The files are UTF-16 with a byte order mark.
- `steamapps/appmanifest_526870.acf`: the Steam build id (`--build` replaces it for other stores).
- `Engine/Binaries/Win64/*-Win64-Shipping.version`: the game version (`GameVersion`).
- `FactoryGame/Content/Paks/*.utoc`/`.ucas` with `CommunityResources/FactoryGame.usmap`: icons, the MAM research trees (names and node links) and the Space Elevator phases (`FactoryGame/GamePhases/GP_Project_Assembly_Phase_N`: costs, last tier, name), which the Docs do not contain. Tree and phase names come from the game's string tables (`MAM_Data`, `Schematics_Data`), in English and German.

## Icons

Icons are not in the repository. They are copyrighted game assets, extracted locally into `public/icons/<Id>.webp` (128 × 128 px WebP, ignored by git) and packed only into the module ZIP. An item or building has `icon` set only when its file was written.

## Running the extraction

Needs Node 24, the .NET 10 SDK (any install, or a portable one passed with `--dotnet`) and an Oodle core library (`oo2core_9_win64.dll`) to decompress the game archives. The game does not ship one as a separate file; it comes with other Unreal Engine games and with the Unreal Engine itself.

```sh
pnpm --filter @tavora/satisfactory extract-data <game folder> --oodle <oo2core_9_win64.dll> [--dotnet <dotnet>] [--accept]
```

`tools/extract-data.ts` reads the Docs (`tools/game-docs.ts`) and runs `tools/asset-export` (a .NET console tool using [CUE4Parse](https://github.com/FabianFG/CUE4Parse) from NuGet) for icons and research trees. Build output of the .NET tool goes to the system temp folder.

The game's `FactoryGame.usmap` writes optional properties without an inner type, which CUE4Parse cannot read. `tools/usmap.ts` passes a patched copy; only test and editor structs use optional properties.

### Guards

The run fails, writing nothing, when:

- items, recipes or buildings appear or disappear compared to the pinned file (rerun with `--accept` after checking the list);
- the Docs contain a native class, a field on a read class, a schematic type, an unlock type, a producer, an item form or a stack size the extractor does not know;
- an item gets several standard recipes and none is named like the item, until a choice is added to `DEFAULT_RECIPE_CHOICES` in `tools/game-docs.ts`.

The output has sorted keys, so a new game build shows up as a readable diff.

## What is included and how

- **Items**: all item descriptors (parts, resources, equipment, consumables, ammo, power shards). `special` covers Power Shards, Somersloops and alien artifacts no recipe makes. Fluid amounts and fluid energy are converted from litres to m³. Sink points are left out for fluids (the AWESOME Sink takes solids only) and when the game gives 0.
- **Recipes**: production recipes only, those that run in a production building. Crafting bench, Equipment Workshop and build gun recipes are left out; build gun recipes give the buildings' build costs. `producedIn` lists only production buildings (crafting stations are dropped). A recipe is alternate when its English name starts with "Alternate:"; this follows the game's labels, so the MAM Turbofuel recipe (class `Recipe_Alternate_Turbofuel_C`) counts as standard.
- **Variable power**: for recipes in the Particle Accelerator, Converter and Quantum Encoder, `variablePowerMW` is `min` = the recipe's constant and `max` = constant + factor. Recipes in fixed-power buildings carry such values too; the game ignores them there, and so does the data.
- **Buildings**: production buildings, extractors, generators, logistics (belts, lifts, pipes, pumps, splitters, mergers, storage, stations) and a few others (HUB, Space Elevator, AWESOME Sink and Shop, MAM, Radar Tower, Power Storage, Alien Power Augmenter, portals, Blueprint Designers). Architecture, decoration, power poles, hypertubes, railway parts and vehicles are left out. `powerMW` is consumption; generators have none.
- **Unlocks**: from schematics. Milestones and HUB upgrades (tier 0) become `milestone`; background schematics count as the milestone or research that grants them; MAM research becomes `mam` with its tree; hard drive research `hardDrive`; AWESOME Shop `awesomeShop`; the starting schematic `start`. MAM nodes that are in no research tree (marked "Discontinued" in the game) are not counted as unlocks.
- **Progress**: what the Progress panel lists.
  - *Phases* 0 to 5, from the phase assets, not from the older `mGamePhaseCosts` table in `BP_GamePhaseManager` (it has 500 Smart Plating for phase 2; the game asks 1000). Phases 6 and 7 cost nothing and are left out. `lastTier` is the highest milestone tier open once the phase is reached.
  - *Milestones*: HUB upgrades (tier 0) and milestones (tiers 1 to 9), by tier and then the HUB's order (`mMenuPriority`). Each has its cost (fluids in m³), what it unlocks (production recipes, buildings the build gun places, Equipment Workshop items, including those of the background schematics it grants) and `requires` from `mSchematicDependencies`.
  - *Research*: the MAM trees with their nodes, top-down. A node's `requires` are the nodes at its parent positions in the tree; some nodes still list positions where no node is left, which are skipped. The Hard Drive tree, where hard drives are analysed, is left out. Hard drives are no item in the Docs, so research that takes one has `hardDrives` besides its cost.
  - *Hard drives*: each choice a hard drive can offer that unlocks a production recipe, with its `requires`. A requirement on a background schematic is replaced by the milestone or research that grants it.
  - The run fails when a shown cost names an unknown item, a milestone's tier is opened by no phase, an entry needs "one of" several schematics, or a dependency type is new.
- **Default recipes**: the only standard recipe that makes the item first; with several, the one named like the item; otherwise the choice in `DEFAULT_RECIPE_CHOICES`. Resources never get one, and a fluid never defaults to unpacking its own package.
