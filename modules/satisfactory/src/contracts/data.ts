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
