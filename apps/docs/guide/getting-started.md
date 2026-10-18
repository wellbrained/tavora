# Getting started

A Tavora module is a web page that runs in a sandboxed panel inside Tavora Desktop, next to a game. It talks to the host through `@tavora/sdk`, and it ships as a folder with a [`tavora.module.json`](../reference/manifest.md) manifest and its built files.

::: warning Preview
`@tavora/sdk` speaks [bridge protocol v1](../reference/protocol.md). Until Tavora's first public release it can still change in ways that break modules; the [changelog](../reference/changelog.md) marks each such change and says which Tavora a version needs.
:::

## Make a project

```sh
npm create @tavora/module
```

It asks where the project goes (the empty folder you are in, or a new folder in it), the module's name, its id (`publisher.module-name`) and a template: vanilla TypeScript, Vue or React. The project builds with Vite and depends on `@tavora/sdk` and `@tavora/pack`; its manifest already sets [`minTavora`](../reference/manifest.md) to the Tavora that SDK needs. pnpm works too: `pnpm create @tavora/module`.

```sh
cd my-module
npm install
npm run dev     # builds, then rebuilds on every change: leave it running
```

In Tavora, open **Settings > Development**, choose **Add a development folder…** and pick the project folder, or the folder you keep all your module projects in: Tavora loads every project directly inside it, and finds new ones by itself. The module appears in Add module, and its panels reload by themselves when `npm run dev` rebuilds.

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

Settings go in `tavora.storage`, the player's work in `tavora.documents`, pictures in `tavora.blobs` and where a panel is scrolled to in `tavora.panel`. Which to use when, and how two open panels avoid overwriting each other, is in [Saving data](./saving-data.md).

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

What reaches outside the panel needs the player's yes first; see [Permissions and consent](./permissions.md). Following the theme and the language is in [Look and languages](./look-and-languages.md).

## Made for one game

A module made for one game, such as a build planner for Path of Exile 2, lists that game in its manifest:

```json
"games": ["poe2"]
```

Tavora then offers it only in that game: in any other game it is not in Add module at all. `"games": []` means any game. The starter asks which game the module is for and fills this in. The ids of Tavora's built-in games are in the [manifest reference](../reference/manifest.md#game-ids).

Players can also make personal workspaces, which belong to no game, for modules such as notes or a whiteboard. A module for any game is offered there too. If yours only makes sense in a game, add `"workspaces": false` (Tavora 0.18.1 or newer). `tavora.game.getCurrent()` says which one a panel is in: its `kind` is `"game"` or `"workspace"`.

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

The zip holds `tavora.module.json`, the folder your `entry` is in (usually `dist/`), the icon and the changelog, plus `tavora.signature.json`. Your sources and `node_modules` stay out. Use `--out` to choose the file name.

The first run makes your publisher key in `~/.tavora/publisher-key.pem`. **Back it up and never share it**: updates and your players' data depend on it. Read [Your publisher key](./publisher-key.md) before you send the first zip, and link the key to your account there so players see your name.

Players install the zip with **Settings > Modules > Install from zip**. To list it in Tavora's module catalog, where players find it under **Browse** in the module library, publish it with your linked key:

```sh
npx tavora-pack publish <id>-<version>.zip
```

The part of your module id before the first dot is your prefix: the first time you publish under it, it becomes yours, and nobody else can publish under it (an account holds up to 3). A module stays with the key that published its first version, and each new version must be newer. An account can publish 10 versions a day. [Publishing to the catalog](./publishing.md) covers the listing, updates, limits and reports.

While you build, keep loading the module from its development folder: it needs no key, and its data is kept apart from the signed version's.

## Patch notes

Tell players what changed in `changelog.json`, which the starter makes and the manifest's `changelog` names. Add an entry, newest first, every time you raise `version`:

```json
[
  { "version": "0.2.0", "date": "2026-11-02", "notes": ["Filter quests by act.", "Fixed the timer after a game switch."] },
  { "version": "0.1.0", "notes": ["First version."] }
]
```

Players read them under the module in **Settings > Modules > Patch notes**. After an update, the notes newer than the version they had are marked New until they open them. Each line is plain text of at most 500 characters, at most 20 lines per version and 100 versions; `tavora-pack` refuses a changelog Tavora could not show. Needs Tavora 0.18.2 or newer, so set `minTavora` to at least `0.18.2`.

Something not working? See [Troubleshooting](./troubleshooting.md).
