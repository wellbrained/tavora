# Getting started

A Tavora module is a web page that runs in a sandboxed panel inside Tavora Desktop, next to a game. It talks to the host through `@tavora/sdk`, and it ships as a folder with a [`tavora.module.json`](../reference/manifest.md) manifest and its built files.

::: warning Not released yet
`@tavora/sdk` 0.1.0 speaks [bridge protocol v1](../reference/protocol.md). It is not published to npm yet, and nothing here is a stable API before Tavora's first public release. For now, build modules inside the [Tavora repository](https://github.com/wellbrained/tavora) and depend on the SDK as `"@tavora/sdk": "workspace:*"`.
:::

## Start from an example

The same small module is built three ways: [Vue](https://github.com/wellbrained/tavora/tree/main/examples/vue-module), [vanilla TypeScript](https://github.com/wellbrained/tavora/tree/main/examples/vanilla-module) and [React](https://github.com/wellbrained/tavora/tree/main/examples/react-module). Copy one into `examples/`, give it its own `id` in `tavora.module.json`, and run:

```sh
pnpm install
pnpm build                              # SDK, host and example modules
pnpm --filter @tavora/desktop start     # opens Tavora with the example modules
```

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
| Documents | `tavora.documents` | All panels of this module in this game, with revisions |
| UI state | `tavora.panel` | This one panel; removed when it closes |

Nothing is shared between games or between modules. See [Where data lives](../reference/protocol.md#where-data-lives) for the details.

## Build the module

- Bundle everything. A module's page has no network access, so no CDN scripts, web fonts or remote images. To reach a web API, name its host in `permissions.network` and call [`network.fetch`](../reference/protocol.md#network) once the player has granted it.
- Use relative asset paths (Vite: `base: "./"`). The page is served from `tavora-module://<module-id>/`.
- Don't use Ctrl+K (Cmd+K on macOS) as a shortcut. Tavora takes it for its own search before your page sees the key.
- Point the manifest's `entry` at the built HTML file.
- Add `"$schema"` to the manifest so your editor checks it. The schema is published at `https://docs.mytavora.app/schema/tavora.module.schema.json`.

## Share the module

Pack the built module into a zip signed with your publisher key:

```sh
pnpm pack-module examples/vanilla-module
```

The zip holds `tavora.module.json`, the folder your `entry` is in (usually `dist/`) and the icon, plus `tavora.signature.json`. Your sources and `node_modules` stay out. Use `--out` to choose the file name.

The first run makes your publisher key in `~/.tavora/publisher-key.pem` (or the file you pass with `--key`). It stays on your PC. **Back it up and never share it.** The key is who you are to Tavora: the settings and documents your module saves for players belong to your key, so only modules signed by it can see them. Lose the key and your next version counts as a different publisher, whose module starts with empty data. A module signed by another key can never read your module's data, even if it uses the same id.

While you build, keep loading the module from a folder: an unsigned folder module needs no key, and its data is kept apart from the signed version's.

