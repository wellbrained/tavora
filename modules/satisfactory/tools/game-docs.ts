// Turns the game's CommunityResources/Docs files into the module's GameData.
// Everything here is pure, so the tests can feed it small inline fixtures; the
// command line in extract-data.ts reads the files and runs the asset exporter.
//
// The rule throughout: anything the Docs say that this file does not know how to
// read is an error, never a guess. New native classes, fields, unlock types,
// producers or units fail the run and are listed together.

import type {
  Amount,
  Building,
  BuildingKind,
  GameData,
  Item,
  ItemForm,
  ItemKind,
  Localized,
  Recipe,
  Unlock,
} from "../src/contracts/data";

export interface DocsClass {
  ClassName: string;
  [field: string]: unknown;
}

export interface DocsGroup {
  NativeClass: string;
  Classes: DocsClass[];
}

/** A MAM research tree as the asset exporter reads it from the game archives. */
export interface ResearchTree {
  id: string;
  name: Localized;
  /** Schematic class names of the tree's nodes. */
  schematics: string[];
}

export interface IconRequest {
  id: string;
  /** Texture object path as the Docs give it, such as `/Game/FactoryGame/.../IconDesc_IronPlates_256.IconDesc_IronPlates_256`. */
  texture: string;
}

export class DocsError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`The Docs contain ${problems.length} thing(s) the extractor does not understand:\n- ${problems.join("\n- ")}`);
    this.problems = problems;
  }
}

// ---------------------------------------------------------------------------
// Native classes

const ITEM_CLASSES: Record<string, ItemKind> = {
  FGResourceDescriptor: "resource",
  FGItemDescriptor: "part",
  FGItemDescriptorBiomass: "part",
  FGItemDescriptorNuclearFuel: "part",
  FGItemDescriptorPowerBoosterFuel: "part",
  FGEquipmentDescriptor: "equipment",
  FGConsumableDescriptor: "consumable",
  FGAmmoTypeProjectile: "ammo",
  FGAmmoTypeSpreadshot: "ammo",
  FGAmmoTypeInstantHit: "ammo",
  FGPowerShardDescriptor: "special",
};

const BUILDING_CLASSES: Record<string, BuildingKind> = {
  FGBuildableManufacturer: "production",
  FGBuildableManufacturerVariablePower: "production",
  FGBuildableResourceExtractor: "extractor",
  FGBuildableWaterPump: "extractor",
  FGBuildableFrackingExtractor: "extractor",
  FGBuildableFrackingActivator: "extractor",
  FGBuildableGeneratorFuel: "generator",
  FGBuildableGeneratorNuclear: "generator",
  FGBuildableGeneratorGeoThermal: "generator",
  FGBuildableConveyorBelt: "logistics",
  FGBuildableConveyorLift: "logistics",
  FGBuildableAttachmentMerger: "logistics",
  FGBuildableAttachmentSplitter: "logistics",
  FGBuildableMergerPriority: "logistics",
  FGBuildableSplitterSmart: "logistics",
  FGBuildablePipeline: "logistics",
  FGBuildablePipelinePump: "logistics",
  FGBuildablePipelineJunction: "logistics",
  FGBuildablePipeReservoir: "logistics",
  FGBuildableStorage: "logistics",
  FGCentralStorageContainer: "logistics",
  FGBuildableRailroadStation: "logistics",
  FGBuildableTrainPlatformCargo: "logistics",
  FGBuildableDockingStation: "logistics",
  FGBuildableDroneStation: "logistics",
  FGBuildableTradingPost: "other",
  FGBuildableSpaceElevator: "other",
  FGBuildableResourceSink: "other",
  FGBuildableResourceSinkShop: "other",
  FGBuildableMAM: "other",
  FGBuildableRadarTower: "other",
  FGBuildablePowerStorage: "other",
  FGBuildablePowerBooster: "other",
  FGBuildablePortal: "other",
  FGBuildablePortalSatellite: "other",
  FGBuildableBlueprintDesigner: "other",
};

const VARIABLE_POWER_CLASS = "FGBuildableManufacturerVariablePower";
const RECIPE_CLASS = "FGRecipe";
const SCHEMATIC_CLASS = "FGSchematic";
const BUILDING_DESCRIPTOR_CLASS = "FGBuildingDescriptor";

/** Classes the module has no use for: the actors behind equipment, vehicles, cosmetics, architecture and decoration. */
const IGNORED_CLASSES = new Set([
  // Equipment actors; their items are FGEquipmentDescriptor and FGConsumableDescriptor entries.
  "FGConsumableEquipment", "FGEquipmentStunSpear", "FGObjectScanner", "FGWeapon", "FGChargedWeapon", "FGGasMask",
  "FGSuitBase", "FGJetPack", "FGHoverPack", "FGChainsaw", "FGParachute", "FGJumpingStilts", "FGEquipmentZipline",
  "FGPortableMinerDispenser", "FGGolfCartDispenser",
  // Vehicles and the customizer.
  "FGVehicleDescriptor", "FGCustomizationRecipe",
  // Architecture, decoration and small infrastructure.
  "FGBuildable", "FGBuildableFactory", "FGBuildableFactoryBuilding", "FGBuildableWall", "FGBuildableWallLightweight",
  "FGBuildableCornerWall", "FGBuildableCornerWallLightweight", "FGBuildableFoundationLightweight", "FGBuildableRampLightweight",
  "FGBuildableBeam", "FGBuildablePillarLightweight", "FGBuildableStair", "FGBuildableWalkway", "FGBuildableWalkwayLightweight",
  "FGBuildableDoor", "FGBuildableLadder", "FGBuildableBarrierCorner", "FGBuildablePassthrough", "FGBuildablePassthroughPipeHyper",
  "FGBuildableLightSource", "FGBuildableFloodlight", "FGBuildableLightsControlPanel", "FGBuildableWidgetSign",
  "FGBuildableStackableShelf", "FGBuildableSnowDispenser", "FGBuildableSnowCannon", "FGBuildableFactorySimpleProducer",
  "FGBuildableConveyorMonitor", "FGBuildablePoleConveyor", "FGBuildablePoleBase", "FGBuildablePoleStackable",
  "FGBuildablePolePipe", "FGBuildablePowerPole", "FGBuildableWire", "FGBuildableCircuitSwitch",
  "FGBuildablePriorityPowerSwitch", "FGPipeHyperStart", "FGBuildablePipeHyper", "FGBuildablePipeHyperJunction",
  "FGBuildableRailroadTrack", "FGBuildableRailroadSignal", "FGBuildableRailroadAttachment", "FGBuildableTrainPlatformEmpty",
  "FGBuildableElevator", "FGBuildableElevatorFloorStop", "FGBuildableJumppad", "FGVehiclePathSegment",
]);

// ---------------------------------------------------------------------------
// Fields the extractor knows. A field outside these lists fails the run, so a
// game update that adds meaning somewhere is looked at before it is shipped.

const DESCRIPTOR_FIELDS = new Set([
  "ClassName", "mDisplayName", "mDescription", "mAbbreviatedDisplayName", "mStackSize", "mCanBeDiscarded",
  "mRememberPickUp", "mEnergyValue", "mRadioactiveDecay", "mForm", "mGasType", "mSmallIcon", "mPersistentBigIcon",
  "mCrosshairMaterial", "mDescriptorStatBars", "mIsAlienItem", "mSubCategories", "mMenuPriority", "mFluidColor",
  "mGasColor", "mCompatibleItemDescriptors", "mClassToScanFor", "mScannableType", "mShouldOverrideScannerDisplayText",
  "mScannerDisplayText", "mScannerLightColor", "mNeedsPickUpMarker", "mGameplayTags", "mResourceSinkPoints",
  "mCachedStackSize",
]);

const DESCRIPTOR_EXTRA_FIELDS: Record<string, string[]> = {
  FGResourceDescriptor: ["mDecalSize", "mPingColor", "mCollectSpeedMultiplier", "mManualMiningAudioName"],
  FGConsumableDescriptor: ["mHealthGain", "mCustomHandsMeshScale", "mCustomRotation", "mCustomLocation"],
  FGItemDescriptorNuclearFuel: ["mSpentFuelClass", "mAmountOfWaste"],
  FGPowerShardDescriptor: ["mPowerShardType", "mExtraPotential", "mExtraProductionBoost"],
  FGItemDescriptorPowerBoosterFuel: ["mBoostPercentage", "mBoostDuration"],
};

/** Ammo descriptors also carry weapon stats; the module reads only their descriptor fields. */
const AMMO_CLASSES = new Set(["FGAmmoTypeProjectile", "FGAmmoTypeSpreadshot", "FGAmmoTypeInstantHit"]);

const RECIPE_FIELDS = new Set([
  "ClassName", "FullName", "mDisplayName", "mIngredients", "mProduct", "mManufacturingMenuPriority",
  "mManufactoringDuration", "mManualManufacturingMultiplier", "mProducedIn", "mGameplayTags", "mRelevantEvents",
  "mVariablePowerConsumptionConstant", "mVariablePowerConsumptionFactor",
]);

const SCHEMATIC_FIELDS = new Set([
  "ClassName", "FullName", "mType", "mDisplayName", "mDescription", "mStatisticGameplayTag", "mSubCategories",
  "mMenuPriority", "mTechTier", "mCost", "mTimeToComplete", "mRelevantShopSchematics", "mIsPlayerSpecific", "mUnlocks",
  "mSchematicIcon", "mSmallSchematicIcon", "mSchematicDependencies", "mDependenciesBlocksSchematicAccess",
  "mHiddenUntilDependenciesMet", "mRelevantEvents", "mSchematicUnlockTag", "mGameplayTags", "mIncludeInBuilds",
  "mUnlockName", "mUnlockDescription", "mUnlockIconBig", "mUnlockIconSmall", "mUnlockIconCategory",
]);

const SCHEMATIC_TYPES = new Set([
  "EST_Custom", "EST_Tutorial", "EST_Milestone", "EST_MAM", "EST_Alternate", "EST_HardDrive", "EST_ResourceSink",
  "EST_Customization",
]);

/** Unlock entries of a schematic, with the field that lists recipes or schematics where they have one. */
const UNLOCK_CLASSES: Record<string, { recipes?: string; schematics?: string }> = {
  BP_UnlockRecipe_C: { recipes: "mRecipes" },
  BP_UnlockBlueprints_C: { recipes: "mRecipes" },
  BP_UnlockSchematic_C: { schematics: "mSchematics" },
  BP_UnlockScannableResource_C: {}, BP_UnlockEmote_C: {}, BP_UnlockArmEquipmentSlot_C: {}, BP_UnlockInventorySlot_C: {},
  BP_UnlockItemDescriptor_C: {}, FGUnlockTape: {}, BP_UnlockInfoOnly_C: {}, BP_UnlockCustomizer_C: {},
  BP_UnlockScannableObject_C: {}, BP_UnlockGiveItem_C: {}, BP_UnlockCheckmark_C: {}, FGUnlockCustomization: {},
  BP_UnlockBuildOverclock_C: {}, BP_UnlockCircuitDaisyChaining_C: {}, BP_UnlockBuildProductionBoost_C: {},
  BP_UnlockCentralStorageUploadSpeed_C: {}, BP_UnlockCentralStorageItemLimit_C: {},
  BP_UnlockCentralStorageUploadSlots_C: {}, BP_UnlockMap_C: {}, BP_UnlockBuildEfficiency_C: {},
};

/**
 * Power-related fields of the production, extractor and generator buildings, whose power the planner uses.
 * Any other field with such a name on them fails the run.
 */
const PLANNED_KINDS = new Set<BuildingKind>(["production", "extractor", "generator"]);
const POWER_FIELD = /power|consum|potential|production|boost|energy/i;
const KNOWN_POWER_FIELDS = new Set([
  "CurrentPotentialChangedDelegate", "IsPowered", "mBaseProductionBoost", "mCachedCurrentPotential",
  "mCanChangePotential", "mCanChangeProductionBoost", "mDefaultPotentialExtractionPerMinute",
  "mEstimatedMaximumPowerConsumption", "mEstimatedMininumPowerConsumption", "mHasInventoryPotential", "mMaxPotential",
  "mMaxPowerProduction", "mMinPotential", "mMinPowerProduction", "mOnHasPowerChanged", "mOnHasProductionChanged",
  "mOnPendingPotentialChanged", "mOnPendingProductionBoostChanged", "mOverridePotentialShardSlots",
  "mOverrideProductionShardSlotSize", "mPotentialShardSlots", "mPowerConsumption", "mPowerConsumptionExponent",
  "mPowerProduction", "mProductionBoostPowerConsumptionExponent", "mProductionEffectsRunning",
  "mProductionShardBoostMultiplier", "mProductionShardSlotSize", "mSupplementalToPowerRatio",
  "mVariablePowerProductionConstant", "mVariablePowerProductionCycleLength", "mVariablePowerProductionCycleOffset",
  "mVariablePowerProductionFactor", "m_CurrentPotential",
]);

// ---------------------------------------------------------------------------
// Recipes, producers and choices

/** Producers that are not production buildings: hand crafting, the build gun, and a workbench class without a buildable. */
const NON_PRODUCTION_PRODUCERS = new Set([
  "BP_WorkBenchComponent_C", "BP_WorkshopComponent_C", "BP_BuildGun_C", "FGBuildGun", "FGBuildableAutomatedWorkBench",
  "Build_AutomatedWorkBench_C",
]);
const BUILD_GUN_PRODUCERS = new Set(["BP_BuildGun_C", "FGBuildGun"]);

/** The schematic every new game starts with. */
const START_SCHEMATIC = "Schematic_StartingRecipes_C";

/**
 * Items with several standard recipes and none named like the item. The planner needs one to start
 * with; players switch it in the planner. A new ambiguity fails the run until it is added here.
 */
export const DEFAULT_RECIPE_CHOICES: Record<string, string> = {
  // Leaves are the first biomass source a new game gets.
  Desc_GenericBiomass_C: "Recipe_Biomass_Leaves_C",
  // Iron Ore is the most common input of the three conversions.
  Desc_FicsiteIngot_C: "Recipe_FicsiteIngot_Iron_C",
  // Blue Power Slugs are the first power shard source.
  Desc_CrystalShard_C: "Recipe_PowerCrystalShard_1_C",
  // The unpackaged ammo recipe, unlocked with the ammo itself.
  Desc_CartridgeChaos_C: "Recipe_CartridgeChaos_C",
  // Hogs are the most common creature.
  Desc_AlienProtein_C: "Recipe_Protein_Hog_C",
};

const STACK_SIZES = new Set(["SS_ONE", "SS_SMALL", "SS_MEDIUM", "SS_BIG", "SS_HUGE", "SS_FLUID"]);
const FORMS: Record<string, ItemForm> = { RF_SOLID: "solid", RF_LIQUID: "liquid", RF_GAS: "gas" };
/** Docs store fluid amounts and fluid energy per litre; the module works in cubic metres. */
const LITRES_PER_CUBIC_METRE = 1000;

// ---------------------------------------------------------------------------
// Small parsers for Unreal's text export

/** Decodes a Docs file: UTF-16 LE with a byte order mark, or UTF-8. */
export function decodeDocs(bytes: Uint8Array): DocsGroup[] {
  let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder("utf-16le").decode(bytes.subarray(2));
  else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) text = new TextDecoder().decode(bytes.subarray(3));
  else text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const docs: unknown = JSON.parse(text);
  if (
    !Array.isArray(docs) ||
    !docs.every(
      (group) =>
        typeof group?.NativeClass === "string" &&
        Array.isArray(group.Classes) &&
        group.Classes.every((c: unknown) => typeof (c as DocsClass)?.ClassName === "string"),
    )
  ) {
    throw new Error("The Docs file is not a list of native classes.");
  }
  return docs as DocsGroup[];
}

/** `/Script/CoreUObject.Class'/Script/FactoryGame.FGRecipe'` → `FGRecipe`. */
export function nativeClassName(nativeClass: string): string {
  const match = /^\/Script\/CoreUObject\.Class'\/Script\/FactoryGame\.(\w+)'$/.exec(nativeClass);
  if (!match?.[1]) throw new Error(`Unexpected native class ${nativeClass}.`);
  return match[1];
}

/** The class name at the end of an object path: `/Game/.../Build_X.Build_X_C` → `Build_X_C`, `/Script/FactoryGame.FGBuildGun` → `FGBuildGun`. */
export function classNameOf(path: string): string {
  const match = /\.([\w-]+)'?$/.exec(path);
  if (!match?.[1]) throw new Error(`Unexpected object path ${path}.`);
  return match[1];
}

/** A parenthesised list of quoted paths, such as `("/Game/A.A_C","/Script/FactoryGame.B")`; empty for `""`. */
export function parsePathList(value: unknown): string[] {
  if (value === "" || value === undefined) return [];
  if (typeof value !== "string" || !value.startsWith("(") || !value.endsWith(")")) {
    throw new Error(`Unexpected list ${JSON.stringify(value)}.`);
  }
  const inner = value.slice(1, -1);
  const paths = [...inner.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? "");
  if (paths.map((p) => `"${p}"`).join(",") !== inner) throw new Error(`Unexpected list ${value}.`);
  return paths;
}

/** `((ItemClass="/Script/Engine.BlueprintGeneratedClass'/Game/.../Desc_X.Desc_X_C'",Amount=3),...)` → class names and raw amounts. */
export function parseItemAmounts(value: unknown): { item: string; amount: number }[] {
  if (value === "") return [];
  if (typeof value !== "string" || !value.startsWith("(") || !value.endsWith(")")) {
    throw new Error(`Unexpected amounts ${JSON.stringify(value)}.`);
  }
  const entry = /\(ItemClass="([^"]+)",Amount=(\d+(?:\.\d+)?)\)/g;
  const amounts = [...value.matchAll(entry)].map((m) => ({ item: classNameOf(m[1] ?? ""), amount: Number(m[2]) }));
  const rebuilt = `(${[...value.matchAll(entry)].map((m) => m[0]).join(",")})`;
  if (rebuilt !== value) throw new Error(`Unexpected amounts ${value}.`);
  return amounts;
}

export function parseNumber(value: unknown, what: string): number {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) throw new Error(`${what} is not a number: ${JSON.stringify(value)}.`);
  return number;
}

/** `Texture2D /Game/Path/Name.Name` → `/Game/Path/Name.Name`; undefined for `None` or empty. */
export function parseTexture(value: unknown): string | undefined {
  if (value === "None" || value === "" || value === undefined) return undefined;
  const match = typeof value === "string" ? /^Texture2D (\/Game\/[\w\-/]+\.[\w-]+)$/.exec(value) : null;
  if (!match?.[1]) throw new Error(`Unexpected icon ${JSON.stringify(value)}.`);
  return match[1];
}

/** Display text with Windows line breaks and surrounding whitespace removed. */
export function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

// ---------------------------------------------------------------------------
// Reading the Docs

interface Schematic {
  id: string;
  type: string;
  tier: number;
  name: Localized;
  recipes: string[];
  schematics: string[];
}

/** What the Docs alone say. Unlocks wait for the research trees, icons for the exporter. */
export interface Catalog {
  items: Record<string, Item>;
  buildings: Record<string, Building>;
  recipes: Record<string, Omit<Recipe, "unlockedBy">>;
  /** Icon texture per item and building id. */
  textures: Record<string, string>;
  schematics: Record<string, Schematic>;
}

export function readDocs(en: DocsGroup[], de: DocsGroup[]): Catalog {
  const problems: string[] = [];
  const attempt = <T>(what: string, read: () => T): T | undefined => {
    try {
      return read();
    } catch (error) {
      problems.push(`${what}: ${(error as Error).message}`);
      return undefined;
    }
  };

  const german = new Map<string, DocsClass>();
  for (const group of de) for (const c of group.Classes) german.set(`${group.NativeClass}|${c.ClassName}`, c);
  const localized = (group: DocsGroup, c: DocsClass, field: string): Localized => {
    const text: Localized = { en: cleanText(c[field]) };
    const translated = cleanText(german.get(`${group.NativeClass}|${c.ClassName}`)?.[field]);
    if (translated) text.de = translated;
    return text;
  };

  const byNative = new Map<string, DocsGroup[]>();
  for (const group of en) {
    const native = attempt("Native class", () => nativeClassName(group.NativeClass));
    if (native === undefined) continue;
    if (!(native in ITEM_CLASSES) && !(native in BUILDING_CLASSES) && !IGNORED_CLASSES.has(native) &&
        ![RECIPE_CLASS, SCHEMATIC_CLASS, BUILDING_DESCRIPTOR_CLASS].includes(native)) {
      problems.push(`Unknown native class ${native} (${group.Classes.length} classes, such as ${group.Classes[0]?.ClassName}).`);
      continue;
    }
    byNative.set(native, [...(byNative.get(native) ?? []), group]);
  }
  const classesOf = (native: string) => (byNative.get(native) ?? []).flatMap((g) => g.Classes.map((c) => ({ group: g, c })));
  const checkFields = (native: string, c: DocsClass, known: Set<string>, extra: string[] = []) => {
    for (const field of Object.keys(c)) {
      if (!known.has(field) && !extra.includes(field)) problems.push(`${c.ClassName}: unknown field ${field} on ${native}.`);
    }
  };

  // Items
  const items: Record<string, Item> = {};
  const textures: Record<string, string> = {};
  const alien = new Set<string>();
  for (const [native, kind] of Object.entries(ITEM_CLASSES)) {
    for (const { group, c } of classesOf(native)) {
      if (!AMMO_CLASSES.has(native)) checkFields(native, c, DESCRIPTOR_FIELDS, DESCRIPTOR_EXTRA_FIELDS[native]);
      const item = attempt(c.ClassName, () => readItem(c, kind, localized(group, c, "mDisplayName"), localized(group, c, "mDescription")));
      if (!item) continue;
      items[c.ClassName] = item;
      const texture = attempt(c.ClassName, () => parseTexture(c.mPersistentBigIcon) ?? parseTexture(c.mSmallIcon));
      if (texture) textures[c.ClassName] = texture;
      if (c.mIsAlienItem === "True") alien.add(c.ClassName);
    }
  }

  // Buildings
  const buildings: Record<string, Building> = {};
  for (const [native, kind] of Object.entries(BUILDING_CLASSES)) {
    for (const { group, c } of classesOf(native)) {
      for (const field of Object.keys(c)) {
        if (PLANNED_KINDS.has(kind) && POWER_FIELD.test(field) && !KNOWN_POWER_FIELDS.has(field)) problems.push(`${c.ClassName}: unknown field ${field} on ${native}.`);
      }
      const building = attempt(c.ClassName, () => readBuilding(c, kind, native === VARIABLE_POWER_CLASS, localized(group, c, "mDisplayName"), localized(group, c, "mDescription")));
      if (building) buildings[c.ClassName] = building;
    }
  }
  const variablePower = new Set(classesOf(VARIABLE_POWER_CLASS).map(({ c }) => c.ClassName));
  // A building's descriptor shares its name, though not always its case: Build_ConstructorMk1_C is placed
  // from Desc_ConstructorMk1_C, Build_BlueprintDesigner_Mk3_C from Desc_BlueprintDesigner_MK3_C.
  const buildingIds = new Map(Object.keys(buildings).map((id) => [id.toLowerCase(), id]));
  const buildingOfDescriptor = (descriptor: string) => buildingIds.get(descriptor.replace(/^Desc_/, "Build_").toLowerCase());
  for (const { c } of classesOf(BUILDING_DESCRIPTOR_CLASS)) {
    const building = buildingOfDescriptor(c.ClassName);
    if (!building) continue;
    const texture = attempt(c.ClassName, () => parseTexture(c.mPersistentBigIcon) ?? parseTexture(c.mSmallIcon));
    if (texture) textures[building] = texture;
  }

  // Recipes
  const recipes: Record<string, Omit<Recipe, "unlockedBy">> = {};
  const buildCosts = new Map<string, string[]>();
  for (const { group, c } of classesOf(RECIPE_CLASS)) {
    checkFields(RECIPE_CLASS, c, RECIPE_FIELDS);
    attempt(c.ClassName, () => {
      const producers = parsePathList(c.mProducedIn).map(classNameOf);
      const producedIn = producers.filter((p) => buildings[p]?.kind === "production").sort();
      for (const p of producers) {
        if (!producedIn.includes(p) && !NON_PRODUCTION_PRODUCERS.has(p)) throw new Error(`unknown producer ${p}.`);
      }
      const amounts = (field: string) =>
        parseItemAmounts(c[field]).map(({ item, amount }): Amount => {
          const known = items[item];
          if (!known) throw new Error(`unknown item ${item} in ${field}.`);
          return { item, amount: known.form !== "solid" ? round(amount / LITRES_PER_CUBIC_METRE) : amount };
        });
      if (producedIn.length === 0) {
        // Build gun recipes give the building costs; workshop and crafting bench recipes are left out.
        if (producers.some((p) => BUILD_GUN_PRODUCERS.has(p))) {
          const product = parseItemAmounts(c.mProduct);
          const building = product.length === 1 && product[0] ? buildingOfDescriptor(product[0].item) : undefined;
          if (building && buildings[building]) {
            buildCosts.set(building, [...(buildCosts.get(building) ?? []), c.ClassName]);
            buildings[building].buildCost = amounts("mIngredients");
          }
        }
        return;
      }
      const products = amounts("mProduct");
      const first = products[0];
      if (!first) throw new Error("no products.");
      const name = localized(group, c, "mDisplayName");
      const recipe: Omit<Recipe, "unlockedBy"> = {
        id: c.ClassName,
        // A recipe without a name is shown with its product's name.
        name: name.en ? name : { ...items[first.item]!.name },
        alternate: /^Alternate:/.test(name.en),
        producedIn,
        durationSeconds: parseNumber(c.mManufactoringDuration, "mManufactoringDuration"),
        ingredients: amounts("mIngredients"),
        products,
      };
      const variable = producedIn.filter((p) => variablePower.has(p));
      if (variable.length > 0) {
        if (variable.length !== producedIn.length) throw new Error("runs in buildings with fixed and variable power.");
        // The game ignores these fields in fixed-power buildings, so they are read only here.
        const min = parseNumber(c.mVariablePowerConsumptionConstant, "mVariablePowerConsumptionConstant");
        const range = parseNumber(c.mVariablePowerConsumptionFactor, "mVariablePowerConsumptionFactor");
        recipe.variablePowerMW = { min: round(min), max: round(min + range) };
      }
      recipes[c.ClassName] = recipe;
    });
  }
  for (const [building, from] of buildCosts) {
    if (from.length > 1) problems.push(`${building}: several build recipes (${from.join(", ")}).`);
  }

  // Alien artifacts no recipe makes (Mercer Spheres) are special finds, like Power Shards and Somersloops.
  const made = new Set(Object.values(recipes).flatMap((r) => r.products.map((p) => p.item)));
  for (const id of alien) {
    const item = items[id];
    if (item && item.kind === "part" && !made.has(id)) item.kind = "special";
  }

  // Schematics
  const schematics: Record<string, Schematic> = {};
  for (const { group, c } of classesOf(SCHEMATIC_CLASS)) {
    checkFields(SCHEMATIC_CLASS, c, SCHEMATIC_FIELDS);
    attempt(c.ClassName, () => {
      const type = String(c.mType);
      if (!SCHEMATIC_TYPES.has(type)) throw new Error(`unknown schematic type ${type}.`);
      if (!Array.isArray(c.mUnlocks)) throw new Error("mUnlocks is not a list.");
      const schematic: Schematic = {
        id: c.ClassName,
        type,
        tier: parseNumber(c.mTechTier, "mTechTier"),
        name: localized(group, c, "mDisplayName"),
        recipes: [],
        schematics: [],
      };
      for (const unlock of c.mUnlocks as Record<string, unknown>[]) {
        const known = UNLOCK_CLASSES[String(unlock.Class)];
        if (!known) throw new Error(`unknown unlock ${String(unlock.Class)}.`);
        if (known.recipes) schematic.recipes.push(...parsePathList(unlock[known.recipes]).map(classNameOf));
        if (known.schematics) schematic.schematics.push(...parsePathList(unlock[known.schematics]).map(classNameOf));
      }
      schematics[c.ClassName] = schematic;
    });
  }
  if (!schematics[START_SCHEMATIC]) problems.push(`The start schematic ${START_SCHEMATIC} is missing.`);

  if (problems.length > 0) throw new DocsError(problems);
  return { items, buildings, recipes, textures, schematics };
}

function readItem(c: DocsClass, kind: ItemKind, name: Localized, description: Localized): Item {
  const form = FORMS[String(c.mForm)];
  if (!form) throw new Error(`unexpected form ${String(c.mForm)}.`);
  const stack = String(c.mStackSize);
  if (!STACK_SIZES.has(stack)) throw new Error(`unexpected stack size ${stack}.`);
  if ((stack === "SS_FLUID") !== (form !== "solid")) throw new Error(`stack size ${stack} does not fit form ${form}.`);
  if (!name.en) throw new Error("no name.");
  const item: Item = { id: c.ClassName, name, description, form, kind };
  if (form === "solid") item.stackSize = parseNumber(c.mCachedStackSize, "mCachedStackSize");
  // The AWESOME Sink takes solids only; zero points mean it refuses the item.
  if (form === "solid" && c.mResourceSinkPoints !== undefined) {
    const points = parseNumber(c.mResourceSinkPoints, "mResourceSinkPoints");
    if (points > 0) item.sinkPoints = points;
  }
  const energy = parseNumber(c.mEnergyValue, "mEnergyValue");
  if (energy > 0) item.energyMJ = round(form === "solid" ? energy : energy * LITRES_PER_CUBIC_METRE);
  return item;
}

function readBuilding(c: DocsClass, kind: BuildingKind, variablePower: boolean, name: Localized, description: Localized): Building {
  if (!name.en) throw new Error("no name.");
  const building: Building = { id: c.ClassName, name, description, kind, buildCost: [] };
  const power = c.mPowerConsumption === undefined ? 0 : parseNumber(c.mPowerConsumption, "mPowerConsumption");
  if (power > 0 && !variablePower) building.powerMW = round(power);
  if (building.powerMW !== undefined || variablePower) {
    building.powerExponent = parseNumber(c.mPowerConsumptionExponent, "mPowerConsumptionExponent");
  }
  return building;
}

/** The icons to ask the exporter for: every item and building that names a texture. */
export function iconRequests(catalog: Catalog): IconRequest[] {
  return Object.entries(catalog.textures)
    .map(([id, texture]) => ({ id, texture }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Finishing: unlocks, defaults, icons

export interface FinishInput {
  build: number;
  version: string;
  researchTrees: ResearchTree[];
  /** Ids whose icon file was written. */
  icons: ReadonlySet<string>;
}

export interface FinishReport {
  data: GameData;
  /** MAM schematics that unlock production recipes but sit in no research tree, so no player reaches them. */
  unreachableResearch: string[];
}

const UNLOCK_ORDER: Unlock["kind"][] = ["start", "milestone", "mam", "hardDrive", "awesomeShop", "other"];

export function finish(
  catalog: Catalog,
  input: FinishInput,
  defaultChoices: Record<string, string> = DEFAULT_RECIPE_CHOICES,
): FinishReport {
  const problems: string[] = [];
  const treeOf = new Map<string, ResearchTree>();
  for (const tree of input.researchTrees) {
    for (const schematic of tree.schematics) {
      if (treeOf.has(schematic)) problems.push(`${schematic} is in two research trees.`);
      treeOf.set(schematic, tree);
    }
  }
  const parents = new Map<string, string[]>();
  for (const s of Object.values(catalog.schematics)) {
    for (const child of s.schematics) parents.set(child, [...(parents.get(child) ?? []), s.id]);
  }
  const unreachable = new Set<string>();

  const unlocksOf = (id: string, path: string[]): Unlock[] => {
    const s = catalog.schematics[id];
    if (!s) return [{ kind: "other", name: { en: id } }];
    if (path.includes(id)) {
      problems.push(`Schematics unlock each other in a loop: ${[...path, id].join(" → ")}.`);
      return [];
    }
    switch (s.type) {
      case "EST_Tutorial":
      case "EST_Milestone":
        return [{ kind: "milestone", tier: s.tier, name: s.name }];
      case "EST_MAM": {
        const tree = treeOf.get(id);
        if (!tree) {
          unreachable.add(id);
          return [];
        }
        return [{ kind: "mam", tree: tree.name, name: s.name }];
      }
      case "EST_Alternate":
        return [{ kind: "hardDrive" }];
      case "EST_ResourceSink":
        return [{ kind: "awesomeShop", name: s.name }];
      default: {
        if (id === START_SCHEMATIC) return [{ kind: "start" }];
        // Background schematics are granted by the milestone or research that unlocks them.
        const from = parents.get(id) ?? [];
        if (from.length > 0) return from.flatMap((parent) => unlocksOf(parent, [...path, id]));
        return [{ kind: "other", name: s.name }];
      }
    }
  };

  const schematicsOf = new Map<string, string[]>();
  for (const s of Object.values(catalog.schematics)) {
    for (const recipe of s.recipes) schematicsOf.set(recipe, [...(schematicsOf.get(recipe) ?? []), s.id]);
  }

  const recipes: Record<string, Recipe> = {};
  for (const recipe of Object.values(catalog.recipes)) {
    const seen = new Map<string, Unlock>();
    for (const s of schematicsOf.get(recipe.id) ?? []) {
      for (const unlock of unlocksOf(s, [])) seen.set(JSON.stringify(sortKeys(unlock)), unlock);
    }
    const unlockedBy = [...seen.values()].sort(
      (a, b) =>
        UNLOCK_ORDER.indexOf(a.kind) - UNLOCK_ORDER.indexOf(b.kind) ||
        ("tier" in a && "tier" in b ? a.tier - b.tier : 0) ||
        compareText(unlockLabel(a), unlockLabel(b)),
    );
    recipes[recipe.id] = { ...recipe, unlockedBy };
  }

  const items: Record<string, Item> = {};
  for (const item of Object.values(catalog.items)) {
    items[item.id] = input.icons.has(item.id) ? { ...item, icon: `icons/${item.id}.webp` } : { ...item };
  }
  const buildings: Record<string, Building> = {};
  for (const building of Object.values(catalog.buildings)) {
    buildings[building.id] = input.icons.has(building.id) ? { ...building, icon: `icons/${building.id}.webp` } : { ...building };
  }

  const resources = Object.values(items).filter((i) => i.kind === "resource").map((i) => i.id).sort();
  const defaultRecipe: Record<string, string> = {};
  const pinned = new Set<string>();
  const standard = Object.values(recipes).filter((r) => !r.alternate);
  // Unpacking a fluid from a package that is itself filled with that fluid would send the planner in a
  // circle, so such recipes never become a fluid's default (Heavy Oil Residue has none, as in the game).
  const unpacks = (recipe: Recipe, fluid: string) =>
    recipe.ingredients.some((i) =>
      standard.some((r) => r.products[0]?.item === i.item && r.ingredients.some((j) => j.item === fluid)),
    );
  for (const item of Object.values(items)) {
    if (item.kind === "resource") continue;
    const candidates = standard.filter(
      (r) => r.products[0]?.item === item.id && !(item.form !== "solid" && unpacks(r, item.id)),
    );
    if (candidates.length === 0) continue;
    const named = candidates.filter((r) => r.name.en === item.name.en);
    const choice = defaultChoices[item.id];
    if (candidates.length === 1) defaultRecipe[item.id] = candidates[0]!.id;
    else if (named.length === 1) defaultRecipe[item.id] = named[0]!.id;
    else if (choice && candidates.some((r) => r.id === choice)) {
      defaultRecipe[item.id] = choice;
      pinned.add(item.id);
    } else {
      problems.push(`${item.id} has several standard recipes (${candidates.map((r) => r.id).join(", ")}); pick one in DEFAULT_RECIPE_CHOICES.`);
    }
  }
  for (const item of Object.keys(defaultChoices)) {
    if (!pinned.has(item)) problems.push(`DEFAULT_RECIPE_CHOICES.${item} is no longer needed or no longer valid.`);
  }

  if (problems.length > 0) throw new DocsError(problems);
  return {
    data: {
      format: "tavora.satisfactory.data",
      version: 1,
      game: { build: input.build, version: input.version },
      items,
      recipes,
      buildings,
      resources,
      defaultRecipe,
    },
    unreachableResearch: [...unreachable].sort(),
  };
}

const unlockLabel = (unlock: Unlock) => ("name" in unlock ? unlock.name.en : "");
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------------------
// Output and the guard against silent changes

/** Objects with their keys sorted, arrays as they are, so the output diffs cleanly. */
export function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sortKeys) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    ) as T;
  }
  return value;
}

export function serialize(data: GameData): string {
  return `${JSON.stringify(sortKeys(data), null, 1)}\n`;
}

/** Items, recipes and buildings that appeared or disappeared since the pinned data. */
export function compareIds(previous: GameData, next: GameData): string[] {
  const changes: string[] = [];
  for (const key of ["items", "recipes", "buildings"] as const) {
    const before = new Set(Object.keys(previous[key]));
    const after = new Set(Object.keys(next[key]));
    const added = [...after].filter((id) => !before.has(id)).sort();
    const removed = [...before].filter((id) => !after.has(id)).sort();
    if (added.length > 0) changes.push(`New ${key}: ${added.join(", ")}`);
    if (removed.length > 0) changes.push(`Missing ${key}: ${removed.join(", ")}`);
  }
  return changes;
}
