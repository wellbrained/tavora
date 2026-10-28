// Built-in list of games a user can pick when adding a game. It only gives
// a canonical id and name: being listed says nothing about module support.
// More games come from the online search (api.mytavora.app); this list is what
// still works offline, and its ids are frozen.

export interface CatalogGame {
  /** Canonical id. Also the id of the user's game, so data stays keyed on it. */
  id: string;
  name: string;
  /** Other names people search for. */
  aliases?: string[];
  /** The game's Steam application id, when it is on Steam. Used to fetch its icon on the user's PC. */
  steamAppId?: number;
  /** One of the few games most people know: offered as a one-click tile in the first-run welcome. */
  popular?: true;
}

export const CATALOG: readonly CatalogGame[] = [
  { id: "age-of-empires-2", name: "Age of Empires II", aliases: ["AoE2", "AoE 2"], steamAppId: 813780 },
  { id: "alchemy-factory", name: "Alchemy Factory", steamAppId: 3669570 },
  { id: "apex-legends", name: "Apex Legends", steamAppId: 1172470 },
  { id: "baldurs-gate-3", name: "Baldur's Gate 3", aliases: ["BG3"], popular: true, steamAppId: 1086940 },
  { id: "battlefield-6", name: "Battlefield 6", aliases: ["BF6"], steamAppId: 2807960 },
  { id: "civilization-6", name: "Sid Meier's Civilization VI", aliases: ["Civ 6"], steamAppId: 289070 },
  { id: "counter-strike-2", name: "Counter-Strike 2", aliases: ["CS2"], popular: true, steamAppId: 730 },
  { id: "cyberpunk-2077", name: "Cyberpunk 2077", steamAppId: 1091500 },
  { id: "dark-souls-3", name: "Dark Souls III", steamAppId: 374320 },
  { id: "dead-by-daylight", name: "Dead by Daylight", aliases: ["DbD"], steamAppId: 381210 },
  { id: "deep-rock-galactic", name: "Deep Rock Galactic", steamAppId: 548430 },
  { id: "destiny-2", name: "Destiny 2", steamAppId: 1085660 },
  { id: "diablo-4", name: "Diablo IV", aliases: ["D4"], steamAppId: 2344520 },
  { id: "dota-2", name: "Dota 2", popular: true, steamAppId: 570 },
  { id: "elden-ring", name: "Elden Ring", popular: true, steamAppId: 1245620 },
  { id: "enshrouded", name: "Enshrouded", steamAppId: 1203620 },
  { id: "factorio", name: "Factorio", steamAppId: 427520 },
  { id: "final-fantasy-14", name: "Final Fantasy XIV", aliases: ["FFXIV", "FF14"], steamAppId: 39210 },
  { id: "fortnite", name: "Fortnite", popular: true },
  { id: "genshin-impact", name: "Genshin Impact" },
  { id: "grand-theft-auto-5", name: "Grand Theft Auto V", aliases: ["GTA 5", "GTA V"], steamAppId: 271590 },
  { id: "guild-wars-2", name: "Guild Wars 2", aliases: ["GW2"], steamAppId: 1284210 },
  { id: "hades-2", name: "Hades II", steamAppId: 1145350 },
  { id: "helldivers-2", name: "Helldivers 2", steamAppId: 553850 },
  { id: "hollow-knight", name: "Hollow Knight", steamAppId: 367520 },
  { id: "last-epoch", name: "Last Epoch", steamAppId: 899770 },
  { id: "league-of-legends", name: "League of Legends", aliases: ["LoL"], popular: true },
  { id: "lost-ark", name: "Lost Ark", steamAppId: 1599340 },
  { id: "minecraft", name: "Minecraft", popular: true },
  { id: "monster-hunter-wilds", name: "Monster Hunter Wilds", steamAppId: 2246340 },
  { id: "no-mans-sky", name: "No Man's Sky", steamAppId: 275850 },
  { id: "overwatch-2", name: "Overwatch 2", aliases: ["OW2"], steamAppId: 2357570 },
  { id: "oxygen-not-included", name: "Oxygen Not Included", steamAppId: 457140 },
  { id: "palworld", name: "Palworld", steamAppId: 1623730 },
  { id: "path-of-exile", name: "Path of Exile", aliases: ["PoE"], steamAppId: 238960 },
  { id: "poe2", name: "Path of Exile 2", aliases: ["PoE2", "PoE 2"], popular: true, steamAppId: 2694490 },
  { id: "red-dead-redemption-2", name: "Red Dead Redemption 2", aliases: ["RDR2"], steamAppId: 1174180 },
  { id: "rimworld", name: "RimWorld", steamAppId: 294100 },
  { id: "rocket-league", name: "Rocket League", steamAppId: 252950 },
  { id: "rust", name: "Rust", steamAppId: 252490 },
  { id: "satisfactory", name: "Satisfactory", steamAppId: 526870 },
  { id: "skyrim", name: "The Elder Scrolls V: Skyrim", aliases: ["Skyrim"], steamAppId: 72850 },
  { id: "slay-the-spire", name: "Slay the Spire", aliases: ["StS"], steamAppId: 646570 },
  { id: "starcraft-2", name: "StarCraft II", aliases: ["SC2", "StarCraft 2"] },
  { id: "stardew-valley", name: "Stardew Valley", steamAppId: 413150 },
  { id: "starfield", name: "Starfield", steamAppId: 1716740 },
  { id: "stellaris", name: "Stellaris", steamAppId: 281990 },
  { id: "terraria", name: "Terraria", steamAppId: 105600 },
  { id: "the-sims-4", name: "The Sims 4", aliases: ["Sims 4"], steamAppId: 1222670 },
  { id: "the-witcher-3", name: "The Witcher 3: Wild Hunt", aliases: ["Witcher 3"], steamAppId: 292030 },
  { id: "total-war-warhammer-3", name: "Total War: Warhammer III", aliases: ["TW:WH3", "Warhammer 3", "Total War Warhammer 3"], steamAppId: 1142710 },
  { id: "valheim", name: "Valheim", steamAppId: 892970 },
  { id: "valorant", name: "Valorant" },
  { id: "warframe", name: "Warframe", steamAppId: 230410 },
  { id: "world-of-warcraft", name: "World of Warcraft", aliases: ["WoW"] },
];

export function catalogGame(id: string): CatalogGame | undefined {
  return CATALOG.find((game) => game.id === id);
}

/** The games flagged popular, in the list's order: the first-run welcome offers them as tiles. */
export function popularGames(): CatalogGame[] {
  return CATALOG.filter((game) => game.popular);
}
