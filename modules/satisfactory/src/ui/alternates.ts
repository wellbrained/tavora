// The Alternates dialog's list: every alternate recipe, grouped by what it makes.

import type { GameData, ItemId, Recipe } from "../contracts/data";
import { itemName, localize } from "./names";
import { normalize } from "./search";

export interface AlternateGroup {
  item: ItemId;
  itemName: string;
  recipes: { recipe: Recipe; name: string }[];
}

/**
 * Alternate recipes grouped by their main product, products A to Z. A query keeps the recipes whose name or
 * product (in Tavora's language or English) contains every word of it.
 */
export function alternateGroups(data: GameData, language: string, query = ""): AlternateGroup[] {
  const words = normalize(query).split(" ").filter(Boolean);
  const groups = new Map<ItemId, AlternateGroup>();
  for (const recipe of Object.values(data.recipes)) {
    if (!recipe.alternate) continue;
    const item = recipe.products[0]?.item;
    if (!item) continue;
    const name = localize(recipe.name, language);
    const product = itemName(data, item, language);
    const haystack = normalize([name, recipe.name.en, product, data.items[item]?.name.en ?? ""].join(" "));
    if (!words.every((word) => haystack.includes(word))) continue;
    let group = groups.get(item);
    if (!group) groups.set(item, (group = { item, itemName: product, recipes: [] }));
    group.recipes.push({ recipe, name });
  }
  const sorted = [...groups.values()].sort((a, b) => a.itemName.localeCompare(b.itemName));
  for (const group of sorted) group.recipes.sort((a, b) => a.name.localeCompare(b.name));
  return sorted;
}
