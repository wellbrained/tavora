// Built-in list of games a player can pick when adding a game. It only gives
// a canonical id and name: being listed says nothing about module support.
// Online search and Steam import arrive with the catalog server (Milestone E).

export interface CatalogGame {
  /** Canonical id. Also the id of the player's game, so data stays keyed on it. */
  id: string;
  name: string;
  /** Other names people search for. */
  aliases?: string[];
}

export const CATALOG: readonly CatalogGame[] = [
  { id: "age-of-empires-2", name: "Age of Empires II", aliases: ["AoE2", "AoE 2"] },
  { id: "apex-legends", name: "Apex Legends" },
  { id: "baldurs-gate-3", name: "Baldur's Gate 3", aliases: ["BG3"] },
  { id: "civilization-6", name: "Sid Meier's Civilization VI", aliases: ["Civ 6"] },
  { id: "counter-strike-2", name: "Counter-Strike 2", aliases: ["CS2"] },
  { id: "cyberpunk-2077", name: "Cyberpunk 2077" },
  { id: "dark-souls-3", name: "Dark Souls III" },
  { id: "dead-by-daylight", name: "Dead by Daylight", aliases: ["DbD"] },
  { id: "deep-rock-galactic", name: "Deep Rock Galactic" },
  { id: "destiny-2", name: "Destiny 2" },
  { id: "diablo-4", name: "Diablo IV", aliases: ["D4"] },
  { id: "dota-2", name: "Dota 2" },
  { id: "elden-ring", name: "Elden Ring" },
  { id: "factorio", name: "Factorio" },
  { id: "final-fantasy-14", name: "Final Fantasy XIV", aliases: ["FFXIV", "FF14"] },
  { id: "fortnite", name: "Fortnite" },
  { id: "genshin-impact", name: "Genshin Impact" },
  { id: "grand-theft-auto-5", name: "Grand Theft Auto V", aliases: ["GTA 5", "GTA V"] },
  { id: "guild-wars-2", name: "Guild Wars 2", aliases: ["GW2"] },
  { id: "hades-2", name: "Hades II" },
  { id: "helldivers-2", name: "Helldivers 2" },
  { id: "hollow-knight", name: "Hollow Knight" },
  { id: "last-epoch", name: "Last Epoch" },
  { id: "league-of-legends", name: "League of Legends", aliases: ["LoL"] },
  { id: "lost-ark", name: "Lost Ark" },
  { id: "minecraft", name: "Minecraft" },
  { id: "monster-hunter-wilds", name: "Monster Hunter Wilds" },
  { id: "no-mans-sky", name: "No Man's Sky" },
  { id: "overwatch-2", name: "Overwatch 2", aliases: ["OW2"] },
  { id: "oxygen-not-included", name: "Oxygen Not Included" },
  { id: "palworld", name: "Palworld" },
  { id: "path-of-exile", name: "Path of Exile", aliases: ["PoE"] },
  { id: "poe2", name: "Path of Exile 2", aliases: ["PoE2", "PoE 2"] },
  { id: "red-dead-redemption-2", name: "Red Dead Redemption 2", aliases: ["RDR2"] },
  { id: "rimworld", name: "RimWorld" },
  { id: "rocket-league", name: "Rocket League" },
  { id: "rust", name: "Rust" },
  { id: "satisfactory", name: "Satisfactory" },
  { id: "skyrim", name: "The Elder Scrolls V: Skyrim", aliases: ["Skyrim"] },
  { id: "slay-the-spire", name: "Slay the Spire", aliases: ["StS"] },
  { id: "stardew-valley", name: "Stardew Valley" },
  { id: "starfield", name: "Starfield" },
  { id: "stellaris", name: "Stellaris" },
  { id: "terraria", name: "Terraria" },
  { id: "the-sims-4", name: "The Sims 4", aliases: ["Sims 4"] },
  { id: "the-witcher-3", name: "The Witcher 3: Wild Hunt", aliases: ["Witcher 3"] },
  { id: "valheim", name: "Valheim" },
  { id: "valorant", name: "Valorant" },
  { id: "warframe", name: "Warframe" },
  { id: "world-of-warcraft", name: "World of Warcraft", aliases: ["WoW"] },
];

export function catalogGame(id: string): CatalogGame | undefined {
  return CATALOG.find((game) => game.id === id);
}
