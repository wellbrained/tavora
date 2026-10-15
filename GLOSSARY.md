# Tavora

A local-first gaming companion: each game gets its own workspace of modules.

## Language

**Game**: What a player has a workspace for. A built-in game, a database game or a custom game.
_Avoid_: title, entry

**Canonical id**: The id Tavora itself issued for a game, such as `elden-ring`. It is a name slug, never changes once issued and is the key for the game's data and for a module's `games` list. A game keeps its canonical id when it is renamed.
_Avoid_: slug (as the concept), game key

**Custom game**: A game the player added by name. Its id is local to that player and is not canonical until matched to a database game by a matching key.

**Database game**: A game in Tavora's online game database, with a canonical id, a name, aliases and a matching key.

**Matching key**: A source's own id for a game (Steam appid, Wikidata item id), stored next to the canonical id and never shown as the id. It links a Steam import or a dataset rebuild to the right game.

**Steam import**: The player gives a Steam profile URL or SteamID64, previews their owned games, selects some and adds them to the library.

**Generated badge**: The automatic icon for a game without a drawn one: a monogram whose colour and pattern come from the game's id.
