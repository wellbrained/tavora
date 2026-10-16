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

**Module files**: The pictures a module keeps for one game, stored by the host in a managed folder (one folder per module and game) that the player can move. Players see "pictures"; the SDK and code call each one a `blob` (`blobs.put`, `blobs.list`), and Notes calls them "images" in its own menus.
_Avoid_: attachments, assets

**Steam import**: The player gives a Steam profile URL or SteamID64, previews their owned games, selects some and adds them to the library.

**Generated badge**: The automatic icon for a game without a drawn one: a monogram whose colour and pattern come from the game's id.

**Account**: A person's optional identity with Tavora, identified by an email address and signed into with a sign-in code. One kind for everyone: a player and a module developer have the same account; developer things (a reserved prefix, linked keys) are attached to it. Tavora works fully without one.
_Avoid_: user, login, developer account

**Profile**: The player's name, initials and picture as Tavora shows them. Kept on the PC; when the player is signed in, the account holds it too, so it follows them to another PC.
_Avoid_: avatar (for the whole profile), account (for the name and picture)

**Sign-in code**: The short code Tavora emails to an address; typing it into the app signs in, and creates the account if the address has none. There are no passwords.
_Avoid_: magic link, OTP, password

**Signed-in device**: One Tavora install that is signed into an account, shown by its operating system and since when. The player can sign any of them out from another.
_Avoid_: session (in player-facing text), client, PC name
