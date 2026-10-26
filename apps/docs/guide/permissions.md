# Permissions and consent

A module can do everything inside its own panel without asking anyone. Whatever reaches outside it, such as a web API or the player's Discord, needs the player's yes first. This page is what that looks like from your side; the rules the host enforces are in the [security model](./security.md).

## Ask in the manifest

List what your module needs under `permissions` in [`tavora.module.json`](../reference/manifest.md):

```json
"permissions": {
  "network": ["api.example.com"],
  "connectors": ["discord"]
}
```

- **`network`**: the exact hosts you call with `tavora.network.fetch`, HTTPS only, at most 32. No wildcards, IP addresses or local names. Your page itself still has no network: no `fetch`, remote images, CDN scripts or web fonts.
- **`connectors`**: `"ai-usage"` for the player's Claude and Codex usage, `"discord"` for the Discord app on this PC, `"system-info"` for the PC's hardware and how busy it is, `"media"` for what plays on the PC (Spotify, browsers, video players) with play/pause and skip, `"stream-overlay"` to show your [overlay page](../reference/manifest.md#overlay) in OBS. Tavora keeps the sign-in; you get answers, never a token.
- **`onRequest`**: connectors your module works without, which Tavora should ask for only when it first needs one. So far that's `"stream-overlay"`: list it in `connectors` and `onRequest`, and players are asked on their first Copy OBS link instead of when they add your module.

Ask for as little as you can. Every host and connector is a line in the dialog the player reads.

## What the player sees

When a player adds your module, Tavora shows its own dialog, which your page can't draw or hide. It names each host and connector, and says who made the module:

| Your module is | The dialog says |
| --- | --- |
| A zip signed with a key that is linked to a developer name | "By *name*, signed with their publisher key …" |
| A zip signed with a key that isn't linked | "Signed by the publisher key …" |
| An unsigned folder, such as your development folder | "From a folder on this PC. It is not signed, so Tavora cannot tell who made it." |

How to get your name there is in [Your publisher key](./publisher-key.md#show-your-name).

If the player cancels, the module isn't added. They can take a grant back any time in Settings (Modules > Website access for websites, Integrations for Discord and AI usage, Streaming for overlays), which removes the module's panels. An update that asks for more keeps what was granted, and its panels offer the player to review the new hosts, which they can put off with **Not now**.

## Check before you call

The handshake says what is granted right now:

```ts
const tavora = await connect();
const canFetch = tavora.host.capabilities.includes("network");
```

Without a grant, the call fails with `PERMISSION_DENIED`, and `error.capability` names what is missing. Show something useful instead, such as "Allow api.example.com in Settings > Modules to load prices", rather than an empty panel.

```ts
try {
  const answer = await tavora.network.fetch("https://api.example.com/prices");
} catch (error) {
  if (error instanceof TavoraError && error.code === "PERMISSION_DENIED") showAskForAccess();
  else if (error instanceof TavoraError && error.code === "NETWORK_ERROR") showOffline();
  else throw error;
}
```

A 404 or 500 from the API is an answer with that `status`, not an error.

## Calls that need a click

Some calls need no grant but only work right after the player clicked or pressed a key in your panel, within 2 seconds, one call per press:

- `tavora.links.open(url)`: opens a web page in the game's Browser panel.
- `tavora.clipboard.writeImage(png)`: copies a PNG.
- `tavora.pictures.save(png, name)`: saves a PNG where the player picks in Tavora's save dialog.
- `tavora.ui.showMenu(...)`: a menu Tavora draws above every panel.
- `tavora.overlay.copyLink(key)`: copies an overlay's link for OBS.
- `tavora.overlay.showOverGame(key)`: shows an overlay over the player's game. It needs no permission, only the click.
- `tavora.overlay.preview(key)`: opens a preview window of an overlay. It needs no permission, only the click.
- `tavora.hotkeys.set(action, target, label)`: opens Tavora's hotkey dialog.
- `discord.connect`, `discord.allowControl`, joining a voice channel, muting and unmuting.

Call them straight from the click or key handler. Called later, for example after a timer, an extra `await` on something slow, or on page load, they fail with `PERMISSION_DENIED`.

## Grants follow the publisher

A grant belongs to your module's id together with the key that signed it. A module with your id but another key gets nothing, and neither does your unsigned development folder: it is asked again, as its own module. See [Your publisher key](./publisher-key.md).
