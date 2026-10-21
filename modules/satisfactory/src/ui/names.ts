// Game names in Tavora's language, and the wiki address for an entry.

import type { GameData, ItemId, Localized } from "../contracts/data";

const isGerman = (language: string) => language.toLowerCase().split(/[-_]/)[0] === "de";

/** The German text when Tavora shows German and the data has one, else the English. */
export function localize(text: Localized, language: string): string {
  return isGerman(language) && text.de ? text.de : text.en;
}

/** An item's name, or its id when the data does not know it. */
export function itemName(data: GameData, id: ItemId, language: string): string {
  const item = data.items[id];
  return item ? localize(item.name, language) : id;
}

export function recipeName(data: GameData, id: string, language: string): string {
  const recipe = data.recipes[id];
  return recipe ? localize(recipe.name, language) : id;
}

export function buildingName(data: GameData, id: string, language: string): string {
  const building = data.buildings[id];
  return building ? localize(building.name, language) : id;
}

const WIKI = "https://satisfactory.wiki.gg/wiki/";

/** The community wiki's page for an entry, by its English name. */
export function wikiUrl(name: Localized): string {
  return WIKI + encodeURIComponent(name.en.trim().replace(/ /g, "_"));
}
