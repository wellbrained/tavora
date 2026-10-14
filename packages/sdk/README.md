# @tavora/sdk

Typed client for [Tavora](../../README.md) modules. A module is a web page that runs in a sandboxed panel inside Tavora Desktop; this package is how it talks to the host.

**Status:** 0.1.0, bridge protocol v1. Not published to npm yet: inside this repository, depend on it as `"@tavora/sdk": "workspace:*"`.

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

Every failed call rejects with a `TavoraError`. Check `error.code`, not the message. The codes, limits and the wire format are in [docs/sdk/protocol.md](../../docs/sdk/protocol.md); the manifest every module needs is in [docs/sdk/manifest.md](../../docs/sdk/manifest.md).

Values you store must be JSON. Type parameters such as `get<number>()` are not checked at runtime.

## Examples

The same small module built three ways: [vanilla TypeScript](../../examples/vanilla-module), [React](../../examples/react-module) and [Vue](../../examples/vue-module).

## Building a module

- Bundle everything. Modules have no network access, so no CDN scripts, web fonts or remote images.
- Use relative asset paths (Vite: `base: "./"`). The page is served from `tavora-module://<module-id>/`.
- Point the manifest's `entry` at the built HTML file.
