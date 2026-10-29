# Testing your module

`@tavora/sdk/testing` gives your tests a stand-in for Tavora, so you can run your module's code without it. `createMemoryHost()` returns two things: `sdk`, a complete `TavoraSDK` that keeps everything in memory, and `host`, the controls for your test. Use it in tests only, never in the module you ship.

```ts
import { createMemoryHost } from "@tavora/sdk/testing";

it("saves the plan", async () => {
  const { sdk, host } = createMemoryHost();
  await savePlan(sdk, { name: "Raid" }); // your code, which takes the sdk
  expect(host.documents.list()).toHaveLength(1);
});
```

Write the code you want to test so it takes the `sdk` as an argument, instead of calling `connect()` itself. Then a test passes the memory host's `sdk`, and the real page passes the one from `connect()`.

## It follows the real host

Settings, documents, panel state and the workspace work as they do in Tavora, with the same limits and the same errors:

- Document revisions start at 1 and go up with every save. A save with a stale `ifRevision` fails with `CONFLICT` and the current `revision`, a new document counts as revision 0, and deleting a document that isn't there does nothing.
- `compareAndSet` compares JSON, whatever the order of keys, and answers `false` when the key holds something else.
- A key that is too long, a value that isn't plain JSON, or a store, document or panel state that gets too big throws the same `TavoraError` code as Tavora. Pass `limits` to hit a quota without writing megabytes.
- Values you read are copies, so changing one changes nothing stored.

## Setting up and looking

```ts
const { sdk, host } = createMemoryHost({
  language: "de",
  launch: { reason: "restore", content: { id: "b1", title: "Build 1" } },
});

host.documents.put({ id: "b1", title: "Build 1", data: { level: 5 } }); // already there when the page starts
host.storage.set("view", "grid");
```

`host.storage`, `host.appStorage` and `host.documents` let you fill and read what the module keeps. `host.state`, `host.content`, `host.maximized`, `host.dialog`, `host.live`, `host.overlays` and `host.saved` show what the panel set. `host.calls["ui.showMenu"]` lists the params of every call to a method, oldest first, and `host.log` lists every call in order.

## Events

Raise what Tavora would send:

```ts
host.changeTheme({ mode: "light" });
host.setLanguage("de");
host.resize({ width: 400, height: 300 });
host.emit("documents.changed", { id: "b1", revision: 3, deleted: false });
await host.navigate({ id: "b2", title: "Build 2" }); // runs the panel.onNavigate handler
host.suspend();
```

## Scripted answers

What has no sensible answer in memory (a web request, a menu choice, a leaderboard) answers with nothing, or fails with `INTERNAL` saying so. Script it:

```ts
host.answer("ui.showMenu", () => "delete");
host.answer("network.fetch", ({ url }) => ({ status: 200, url, headers: {}, body: "{}" }));
host.answer("leaderboards.top", () => ({ rows: [] }));
host.answer("storage.get", () => {
  throw new TavoraError({ code: "INTERNAL", message: "disk full" });
});
```

A script wins over the memory host, but a missing permission, a call that needs a click or a method an older Tavora doesn't have is refused first, like in Tavora. `host.unanswer(method)` takes a script away. `leaderboards` keeps a status you can change with `host.leaderboards.setStatus({ signedIn: false })`.

## Two panels

Pass the first panel's `host` to make a second panel of the same module and workspace. They share settings and documents, and each has its own panel state, listeners and calls:

```ts
const first = createMemoryHost();
const second = createMemoryHost({ share: first.host });

await first.sdk.documents.put({ id: "d", title: "D", data: 1 });
// The other panel saved first: this one's stale save now fails.
await second.sdk.documents.put({ id: "d", title: "D", data: 2, ifRevision: 0 }); // CONFLICT, revision 1
```

`second.sdk.documents.onChange` hears the first panel's saves, as in Tavora, and the first one does not hear its own.

## An older Tavora

`createMemoryHost({ version: "0.21.50" })` reports that version and throws `UNKNOWN_METHOD` for the methods a Tavora that old doesn't have, such as `storage.compareAndSet` (0.21.92) or `panel.openDialog` (0.21.95). Use it to test your fallback.

## Clicks

Some calls only work right after a click or key press: opening a menu, `links.open`, saving a file. Tavora refuses them with `PERMISSION_DENIED` otherwise. By default the memory host lets them through, so your tests stay short. Pass `gestures: "enforce"` to test that your module calls them from a click:

```ts
const { sdk, host } = createMemoryHost({ gestures: "enforce" });
await host.click(() => sdk.links.open("https://example.com")); // one click, one call
```
