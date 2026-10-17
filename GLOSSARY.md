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

**Account**: A person's optional identity with Tavora, signed into with one or more sign-in methods (an email address, a Discord login). One kind for everyone: a player and a module developer have the same account; developer things (a reserved prefix, linked keys) are attached to it. Tavora works fully without one.
_Avoid_: user, login, developer account

**Profile**: The player's name, initials and picture as Tavora shows them. Kept on the PC; when the player is signed in, the account holds it too, so it follows them to another PC.
_Avoid_: avatar (for the whole profile), account (for the name and picture)

**Sign-in code**: The short code Tavora emails to an address; typing it into the app signs in, and creates the account if the address has none. There are no passwords.
_Avoid_: magic link, OTP, password

**Sign-in method**: A way into an account: an email address (with a sign-in code) or a Discord login. An account has one or both, never none; a second one is a way back in if the first is lost.
_Avoid_: connector (that is Milestone F's sign-in for modules), provider, login (alone)

**Discord login**: Discord as a sign-in method: the player approves Tavora on Discord's page in the browser, and the account knows them by their Discord user id (the username is only a label). Separate from the Discord connector: no Discord token is kept, and modules get nothing from it.
_Avoid_: Discord connection, Discord account (for Tavora's account)

**Signed-in device**: One Tavora install that is signed into an account, shown by its operating system and since when. The player can sign any of them out from another.
_Avoid_: session (in player-facing text), client, PC name

**Permission**: What a module asks for in the `permissions` of its manifest, such as network to named hosts or a connector. Only a wish: it does nothing until the player grants it.

**Grant**: The player's stored, revocable yes to a module's permission, recorded by the host for the module's publisher, id and version. Every gated call is checked against it. Asked for when the player first adds the module.
_Avoid_: permission (for the player's yes), consent (for the stored record)

**Connector**: A part of Tavora that holds a sign-in to another app or service and lets granted modules use it without seeing the token: Discord and AI Usage.
_Avoid_: integration (for the code), plugin, bridge

**Integrations**: The settings page for connectors and grants: each connection's sign-in or accounts, the modules allowed to use it, and every other module grant, each revocable.

**Publisher key**: The Ed25519 key pair a module developer signs zips with, made on their PC by `tavora-pack` the first time and kept there; the secret half never leaves that PC. Its fingerprint is the publisher a player's data belongs to. Losing it without a linked account means a new publisher.
_Avoid_: certificate, developer key (for the account), signing secret

**Key linking**: Tying a publisher key to an account: Settings > Account shows a one-time code, `tavora-pack link <code>` signs it with the key, and the service stores only the public half. A linked key shows the account's developer name to players and can be claimed back after a loss once the catalogue exists.
_Avoid_: key upload, registering a key

**Developer name**: The public name an account shows on the modules of its linked keys ("by jumoog"). Unique regardless of case, changeable once every 30 days, and a dropped name stays blocked for 30 days. Separate from the private profile name.
_Avoid_: username, publisher name, author (for the account)

**Development folder**: A module project folder a developer adds in Settings > Modules. Tavora loads the module straight from it, reloads its panels when the build changes and lists it as Development; its data counts as local.
_Avoid_: dev mode, sideload, debug module
