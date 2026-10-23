// The game data the module ships, extracted from the game's CommunityResources/Docs
// files and pinned to one stable build. Everything else in the module reads it
// through these types; the extraction script is the only thing that writes it.

/** A Docs class name, such as `Desc_IronPlate_C`. */
export type ItemId = string;
/** A Docs class name, such as `Recipe_IronPlate_C` or `Recipe_Alternate_CastScrew_C`. */
export type RecipeId = string;
/** A Docs class name, such as `Build_ConstructorMk1_C`. */
export type BuildingId = string;

/** A text in the languages the module ships. English is always there. */
export interface Localized {
  en: string;
  de?: string;
}

/** An amount of an item: pieces for solids, cubic metres for liquids and gases (Docs stores fluids ×1000; the script divides). */
export interface Amount {
  item: ItemId;
  amount: number;
}

export interface GameData {
  format: "tavora.satisfactory.data";
  version: 1;
  game: {
    /** The Steam build id the data was extracted from. */
    build: number;
    /** The game version as players know it, such as "1.1". */
    version: string;
  };
  items: Record<ItemId, Item>;
  recipes: Record<RecipeId, Recipe>;
  buildings: Record<BuildingId, Building>;
  /** Items that come out of the ground (ores, water, crude oil, nitrogen gas…). The planner stops at these. */
  resources: ItemId[];
  /**
   * The recipe the planner uses for an item until the player picks another: a standard (not alternate)
   * production recipe whose first product is the item. Items without an entry have no standard production
   * recipe; resources never have one.
   */
  defaultRecipe: Record<ItemId, RecipeId>;
  /** What a playthrough works through: Space Elevator phases, milestones, MAM research and hard drives. */
  progress: Progress;
}

/** A Docs schematic class name, such as `Schematic_3-4_C` or `Research_Caterium_1_C`. */
export type SchematicId = string;

export interface Progress {
  /** Space Elevator phases 0 to 5 in order. Phase 0 is where a game starts and costs nothing. */
  phases: Phase[];
  /** HUB upgrades (tier 0) and milestones (tiers 1 to 9), by tier and then in the HUB's order. */
  milestones: Milestone[];
  /** MAM research trees in the game's order, each with its nodes. */
  research: ResearchTree[];
  /** Hard drive research: each alternate a hard drive can offer, with its prerequisites. */
  hardDrives: HardDrive[];
}

export interface Phase {
  phase: number;
  name: Localized;
  /** What the Space Elevator takes to reach this phase; empty for phase 0. */
  cost: Amount[];
  /** Milestone tiers up to this one are open once the phase is reached. */
  lastTier: number;
}

/** What a schematic gives the player that the module shows. Other unlocks (inventory slots, scanner targets…) are left out. */
export interface Unlocks {
  /** Production recipes, all present in `GameData.recipes`. */
  recipes: RecipeId[];
  /** Buildings the build gun can now place, all present in `GameData.buildings`. */
  buildings: BuildingId[];
  /** Equipment and other items now made in the Equipment Workshop, all present in `GameData.items`. */
  items: ItemId[];
}

export interface Milestone {
  id: SchematicId;
  name: Localized;
  /** 0 for the HUB upgrades. */
  tier: number;
  cost: Amount[];
  unlocks: Unlocks;
  /** Milestones the game wants first, besides the tier being open. Never blocks ticking in the module. */
  requires: SchematicId[];
}

export interface ResearchTree {
  /** The tree's class, such as `BPD_ResearchTree_Caterium_C`. */
  id: string;
  name: Localized;
  /** Nodes from the top of the tree down, left to right. */
  nodes: ResearchNode[];
}

export interface ResearchNode {
  id: SchematicId;
  name: Localized;
  cost: Amount[];
  /** Hard drives the research takes besides `cost`; absent when none. Hard drives are no item in the game data. */
  hardDrives?: number;
  unlocks: Unlocks;
  /** Nodes of the same tree that the game wants researched first. */
  requires: SchematicId[];
}

export interface HardDrive {
  id: SchematicId;
  /** The recipes this choice unlocks, all present in `GameData.recipes`: alternates, sometimes with a standard one. */
  recipes: RecipeId[];
  /** Milestones or research the game wants first before offering it. */
  requires: SchematicId[];
}

export type ItemForm = "solid" | "liquid" | "gas";

export type ItemKind =
  | "resource"
  | "part"
  | "equipment"
  | "consumable"
  | "ammo"
  | "special";

export interface Item {
  id: ItemId;
  name: Localized;
  description: Localized;
  form: ItemForm;
  kind: ItemKind;
  /** Absent for fluids. */
  stackSize?: number;
  /** AWESOME Sink points; absent when it cannot be sunk. */
  sinkPoints?: number;
  /** Energy as fuel in MJ; absent when it is no fuel. */
  energyMJ?: number;
  /** Path of the icon inside the module, such as `icons/Desc_IronPlate_C.webp`; absent when none was extracted. */
  icon?: string;
}

/** How a recipe becomes available to the player. */
export type Unlock =
  | { kind: "start" }
  | { kind: "milestone"; tier: number; name: Localized }
  | { kind: "mam"; tree: Localized; name: Localized }
  | { kind: "hardDrive" }
  | { kind: "awesomeShop"; name: Localized }
  | { kind: "other"; name: Localized };

export interface Recipe {
  id: RecipeId;
  name: Localized;
  alternate: boolean;
  /** The production buildings that run it. Workshop-, crafting-bench- and build-gun-only recipes are not in `recipes`. */
  producedIn: BuildingId[];
  durationSeconds: number;
  ingredients: Amount[];
  /** The first product is the main one; the rest are byproducts. */
  products: Amount[];
  /** Empty when the data has no schematic for it. */
  unlockedBy: Unlock[];
  /** Only for recipes with variable power (Particle Accelerator, Converter, Quantum Encoder): MW at 100 % clock. */
  variablePowerMW?: { min: number; max: number };
}

export type BuildingKind =
  | "production"
  | "extractor"
  | "generator"
  | "logistics"
  | "other";

export interface Building {
  id: BuildingId;
  name: Localized;
  description: Localized;
  kind: BuildingKind;
  /** Consumption at 100 % clock in MW; absent for buildings without power use and for variable-power ones. */
  powerMW?: number;
  /** Power scales with (clock / 100 %) ^ powerExponent. */
  powerExponent?: number;
  /** What the build gun takes to place one; empty when it has no build recipe. */
  buildCost: Amount[];
  icon?: string;
}
