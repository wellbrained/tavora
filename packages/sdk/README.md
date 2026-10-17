# @tavora/sdk

Typed client for [Tavora](../../README.md) modules. A module is a web page that runs in a sandboxed panel inside Tavora Desktop; this package is how it talks to the host.

**Status:** 0.2.1, bridge protocol v1. Not published to npm yet: inside this repository, depend on it as `"@tavora/sdk": "workspace:*"`. What changed in each version is in [CHANGELOG.md](./CHANGELOG.md).

```ts
import { connect, TavoraError } from "@tavora/sdk";

const tavora = await connect();
const game = await tavora.game.getCurrent(); // { id: "poe2", displayName: "Path of Exile 2" }

// Small settings, private to this module in this game.
const count = (await tavora.storage.get<number>("count")) ?? 0;
await tavora.storage.set("count", count + 1);

// Documents are shared by all panels of this module in this game.
const plan = await tavora.documents.get<{ steps: string[] }>("plan");
try {
  await tavora.documents.put({ id: "plan", title: "Plan", data: { steps: ["Act 1"] }, ifRevision: plan?.revision ?? 0 });
} catch (error) {
  if (error instanceof TavoraError && error.code === "CONFLICT") {
    // Another panel saved first: reload instead of overwriting.
  }
}
tavora.documents.onChange(({ id }) => console.log(`${id} changed in another panel`));

// State for this one panel (open tab, scroll position). Removed when the panel closes.
await tavora.panel.setState({ tab: "gear" });

tavora.workspace.onResize(({ width, height }) => {});
tavora.ui.onThemeChange((theme) => {});
tavora.lifecycle.onSuspend(() => {}); // hidden: pause timers and animations
tavora.lifecycle.onResume(() => {});
```

`connect()` can be called any number of times and always returns the same connection. It rejects with a `TavoraError` when the page runs outside Tavora (`HOST_UNAVAILABLE`) or the host speaks another protocol version (`INCOMPATIBLE`).

Every failed call rejects with a `TavoraError`. Check `error.code`, not the message. The codes, limits and the wire format are in the [bridge protocol reference](../../apps/docs/reference/protocol.md); the manifest every module needs is in the [manifest reference](../../apps/docs/reference/manifest.md).

Values you store must be JSON. Type parameters such as `get<number>()` are not checked at runtime.

## More from the host

| API | What it does |
| --- | --- |
| `tavora.storage.app` | The same small settings, shared by every game: for choices the player expects to stay the same from game to game. |
| `tavora.ui.getLanguage()`, `onLanguageChange` | The language of Tavora's own texts (`"en"`, `"de"`). Show your module in it, or in English when you have no translation. |
| `tavora.blobs` | Pictures too big for a document: up to 50 MB each and 500 MB per module and game. `put` a file, show it with `url(id)`. See [Files](../../apps/docs/reference/protocol.md#files-blobs). |
| `tavora.clipboard.writeImage(png)` | Puts a PNG on the system clipboard. Call it from the click or key press that asked for it. See [Clipboard](../../apps/docs/reference/protocol.md#clipboard). |
| `tavora.links.open(url)` | Opens a web address in the game's Browser panel, from a click or key press. |
| `tavora.network.fetch(url, init)` | A web request to a host listed in `permissions.network`, once the player granted it. See [Network](../../apps/docs/reference/protocol.md#network). |
| `tavora.connectors.aiUsage` | The usage of the player's Claude and Codex accounts, with the `ai-usage` connector. |
| `tavora.connectors.discord` | The Discord app on this PC through Tavora's Discord sign-in, with the `discord` connector: voice channels, mute and deafen, voice events. |

What needs the player's permission (`permissions.network` and `permissions.connectors` in the [manifest](../../apps/docs/reference/manifest.md)) works only once the player has granted it: they are asked when they add the module and can take it back in Settings > Integrations. Until then the call fails with `PERMISSION_DENIED`; `tavora.host.capabilities` lists what was granted when the module connected. See [Capabilities](../../apps/docs/reference/protocol.md#capabilities) and [Connectors](../../apps/docs/reference/protocol.md#connectors).

## Examples

The same small module built three ways: [vanilla TypeScript](../../examples/vanilla-module), [React](../../examples/react-module) and [Vue](../../examples/vue-module).

## Building a module

- Bundle everything. A module's page has no network access, so no CDN scripts, web fonts or remote images. To reach a web API, list its host in `permissions.network` and use `tavora.network.fetch` once the player has granted it.
- Use relative asset paths (Vite: `base: "./"`). The page is served from `tavora-module://<module-id>/`.
- Point the manifest's `entry` at the built HTML file.
