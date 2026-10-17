# Getting started

A Tavora module is a web page that runs in a sandboxed panel inside Tavora Desktop, next to a game. It talks to the host through `@tavora/sdk`, and it ships as a folder with a [`tavora.module.json`](../reference/manifest.md) manifest and its built files.

::: warning Preview
`@tavora/sdk` speaks [bridge protocol v1](../reference/protocol.md). Until Tavora's first public release it can still change in ways that break modules; the [changelog](../reference/changelog.md) marks each such change and says which Tavora a version needs.
:::

## Make a project

```sh
npm create @tavora/module
```

It asks for a folder, the module's name, its id (`publisher.module-name`) and a template: vanilla TypeScript, Vue or React. The project builds with Vite and depends on `@tavora/sdk` and `@tavora/pack`; its manifest already sets [`minTavora`](../reference/manifest.md) to the Tavora that SDK needs. pnpm works too: `pnpm create @tavora/module`.

```sh
cd my-module
npm install
npm run dev     # rebuilds on every change
```

In Tavora, open Settings > Modules, choose **Add a development folder** and pick the project folder. The module appears in Add module, and its panels reload by themselves when `npm run dev` rebuilds.

To add the SDK to a project of your own instead: `npm install @tavora/sdk`, and follow [Build the module](#build-the-module). The same small module is also built three ways in Tavora's repository: [Vue](https://github.com/wellbrained/tavora/tree/main/examples/vue-module), [vanilla TypeScript](https://github.com/wellbrained/tavora/tree/main/examples/vanilla-module) and [React](https://github.com/wellbrained/tavora/tree/main/examples/react-module). A module that offers several panels is shown in the [panel types example](https://github.com/wellbrained/tavora/tree/main/examples/panels-module) (see [Panel types](../reference/manifest.md#panel-types)).

## Talk to the host

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

Every failed call rejects with a `TavoraError`. Check `error.code`, not the message. The codes and limits are in the [bridge protocol](../reference/protocol.md#errors), and every method is in the [SDK reference](/api/).

Values you store must be JSON. Type parameters such as `get<number>()` are not checked at runtime.

## Where data lives

| Scope | API | Shared by |
| --- | --- | --- |
| Settings | `tavora.storage` | All panels of this module in this game |
| Settings for every game | `tavora.storage.app` | All panels of this module in every game |
| Documents | `tavora.documents` | All panels of this module in this game, with revisions |
| Pictures | `tavora.blobs` | All panels of this module in this game |
| UI state | `tavora.panel` | This one panel; removed when it closes |

Nothing is shared between modules, and nothing between games except `storage.app`. See [Where data lives](../reference/protocol.md#where-data-lives) for the details.

## More from the host

| API | What it does |
| --- | --- |
| `tavora.ui.getLanguage()`, `onLanguageChange` | The language of Tavora's own texts (`"en"`, `"de"`). Show your module in it, or in English when you have no translation. |
| `tavora.blobs` | Pictures too big for a document: up to 50 MB each and 500 MB per module and game. `put` a file, show it with `url(id)`. See [Files](../reference/protocol.md#files-blobs). |
| `tavora.clipboard.writeImage(png)` | Puts a PNG on the system clipboard. Call it from the click or key press that asked for it. See [Clipboard](../reference/protocol.md#clipboard). |
| `tavora.links.open(url)` | Opens a web address in the game's Browser panel, from a click or key press. |
| `tavora.network.fetch(url, init)` | A web request to a host listed in `permissions.network`, once the player granted it. See [Network](../reference/protocol.md#network). |
| `tavora.connectors.aiUsage` | The usage of the player's Claude and Codex accounts, with the `ai-usage` connector. |
| `tavora.connectors.discord` | The Discord app on this PC through Tavora's Discord sign-in, with the `discord` connector: voice channels, mute and deafen, voice events. |

What needs the player's permission (`permissions.network` and `permissions.connectors` in the [manifest](../reference/manifest.md)) works only once the player has granted it: they are asked when they add the module and can take it back in Settings > Integrations. Until then the call fails with `PERMISSION_DENIED`; `tavora.host.capabilities` lists what was granted when the module connected. See [Capabilities](../reference/protocol.md#capabilities) and [Connectors](../reference/protocol.md#connectors).

## Build the module

- Bundle everything. A module's page has no network access, so no CDN scripts, web fonts or remote images. To reach a web API, name its host in `permissions.network` and call [`network.fetch`](../reference/protocol.md#network) once the player has granted it.
- Use relative asset paths (Vite: `base: "./"`). The page is served from `tavora-module://<module-id>/`.
- Don't use Ctrl+K (Cmd+K on macOS) as a shortcut. Tavora takes it for its own search before your page sees the key.
- Point the manifest's `entry` at the built HTML file.
- Add `"$schema"` to the manifest so your editor checks it. The schema is published at `https://docs.mytavora.app/schema/tavora.module.schema.json`.

## Share the module

Pack the built module into a zip signed with your publisher key:

```sh
npm run build
npm run zip     # the same as npx tavora-pack .
```

The zip holds `tavora.module.json`, the folder your `entry` is in (usually `dist/`) and the icon, plus `tavora.signature.json`. Your sources and `node_modules` stay out. Use `--out` to choose the file name.

The first run makes your publisher key in `~/.tavora/publisher-key.pem` (or the file you pass with `--key`). It stays on your PC. **Back it up and never share it.** The key is who you are to Tavora: the settings and documents your module saves for players belong to your key, so only modules signed by it can see them. Lose the key and your next version counts as a different publisher, whose module starts with empty data. A module signed by another key can never read your module's data, even if it uses the same id.

While you build, keep loading the module from a folder: an unsigned folder module needs no key, and its data is kept apart from the signed version's.

### Show your name instead of a fingerprint

Players see who signed a module as the key's fingerprint, unless the key is linked to a Tavora account with a developer name. Then they see "by <name>" in Settings > Modules, in the dialog that asks for permissions, and when they install your zip.

1. In Tavora, sign in under Settings > Account and choose a **developer name** under Module developer. It is public, unique (case, spaces, dots, dashes and underscores don't count) and can change once every 30 days.
2. Press **Link a publisher key**. Tavora shows a one-time code, valid for 10 minutes.
3. Run the command it shows in your module's folder, with the key you sign with:

   ```sh
   npx tavora-pack link ABCD-EFGH
   ```

   Outside a module project, `npx @tavora/pack link ABCD-EFGH` does the same.

   It signs the code with your publisher key and sends the signature and the key's public half to Tavora's service, which checks the signature before it links the key. The secret key never leaves your PC. Pass `--key` if you sign with another key file.

An account can link several keys; a key belongs to one account. Link your key now, even before you need it: if you ever lose it, only a key that was linked can later be claimed back by your account.

