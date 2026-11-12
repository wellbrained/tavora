# @tavora/sdk

Typed client for [Tavora](https://mytavora.app) modules. A module is a web page that runs in a sandboxed panel inside Tavora Desktop; this package is how it talks to the host.

**Status:** bridge protocol v1, still before 1.0: a minor version can change things, and the [changelog](./CHANGELOG.md) says what and which Tavora a version needs.

Start a new module with `npm create @tavora/module` (or `pnpm create @tavora/module`), or add the SDK to your own project with `npm install @tavora/sdk`.

```ts
import { connect, TavoraError } from "@tavora/sdk";

const tavora = await connect();
const workspace = await tavora.workspace.getCurrent(); // { id: "poe2", displayName: "Path of Exile 2", kind: "game" }

// Small settings, private to this module in this workspace.
const count = (await tavora.storage.get<number>("count")) ?? 0;
await tavora.storage.set("count", count + 1);

// Documents are shared by all panels of this module in this workspace.
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

Every failed call rejects with a `TavoraError`. Check `error.code`, not the message. The codes, limits and the wire format are in the [bridge protocol reference](https://docs.mytavora.app/reference/protocol); the manifest every module needs is in the [manifest reference](https://docs.mytavora.app/reference/manifest).

Values you store must be JSON. Type parameters such as `get<number>()` are not checked at runtime.

## More from the host

| API | What it does |
| --- | --- |
| `tavora.workspace.getCurrent()` | The workspace the panel is in: `{ id, displayName, kind }`, with `kind` `"game"` (a game workspace; the `id` is the game's) or `"personal"`. `tavora.game.getCurrent()` still answers but is deprecated. |
| `tavora.storage.app` | The same small settings, shared by every workspace: for choices the user expects to stay the same from workspace to workspace. |
| `tavora.ui.getLanguage()`, `onLanguageChange` | The language of Tavora's own texts (`"en"`, `"de"`). Show your module in it, or in English when you have no translation. |
| `tavora.blobs` | Pictures too big for a document: up to 50 MB each and 500 MB per module and workspace. `put` a file, show it with `url(id)`. See [Files](https://docs.mytavora.app/reference/protocol#files-blobs). |
| `tavora.clipboard.writeImage(png)` | Puts a PNG on the system clipboard. Call it from the click or key press that asked for it. See [Clipboard](https://docs.mytavora.app/reference/protocol#clipboard). |
| `tavora.pictures.save(png, name)` | Saves a PNG in the user's `Pictures\Tavora` folder and resolves with the file name. Call it from the click or key press that asked for it. See [Saving pictures](https://docs.mytavora.app/reference/protocol#saving-pictures). |
| `tavora.links.open(url)` | Opens a web address in the workspace's Browser panel, from a click or key press. |
| `tavora.network.fetch(url, init)` | A web request to a host listed in `permissions.network`, once the user granted it. See [Network](https://docs.mytavora.app/reference/protocol#network). |
| `tavora.network.readPage(url)` | Capture a public page in an isolated temporary browser, using the same grants. No user sign-ins or module scripts; Tavora 0.19.3+. |
| `tavora.connectors.aiUsage` | The usage of the user's Claude and Codex accounts, with the `ai-usage` connector. |
| `tavora.connectors.systemInfo` | The PC's hardware and how busy it is, with the `system-info` connector: `info()`, `watch(options)`, `onSnapshot`, `onDrivesChange`, and for the connection `connectionLog()`, `clearConnectionLog()`, `connectionSettings()`, `setConnectionSettings(settings)`, `onConnectionChange`. |
| `tavora.connectors.media` | What plays on the PC, with the `media` connector: `watch()`, `unwatch()`, `onChange`, `control(session, action)`. |
| `tavora.connectors.discord` | The Discord app on this PC through Tavora's Discord sign-in, with the `discord` connector: voice channels, mute and deafen, voice events. |

What needs the user's permission (`permissions.network` and `permissions.connectors` in the [manifest](https://docs.mytavora.app/reference/manifest)) works only once the user has granted it: they are asked when they add the module and can take it back in Settings > Connections. Until then the call fails with `PERMISSION_DENIED`; `tavora.host.capabilities` lists what was granted when the module connected. See [Capabilities](https://docs.mytavora.app/reference/protocol#capabilities) and [Connectors](https://docs.mytavora.app/reference/protocol#connectors).

## Examples

The same small module built three ways: [vanilla TypeScript](https://github.com/wellbrained/tavora/tree/main/examples/vanilla-module), [React](https://github.com/wellbrained/tavora/tree/main/examples/react-module) and [Vue](https://github.com/wellbrained/tavora/tree/main/examples/vue-module).

## Testing

`@tavora/sdk/testing` stands in for Tavora in your tests. `createMemoryHost()` gives your code a complete SDK that keeps everything in memory ([Testing your module](https://docs.mytavora.app/guide/testing)). `mountPanel()` runs your real panel on it in a browser, and `checkLayout()` and `checkFocus()` find cut-off text, things sticking out and Tab-key problems ([Testing a panel in the browser](https://docs.mytavora.app/guide/testing-panels)). It needs no particular test runner or browser driver.

## Building a module

- Bundle everything. A module's page has no network access, so no CDN scripts, web fonts or remote images. To reach a web API, list its host in `permissions.network` and use `tavora.network.fetch` once the user has granted it.
- Use relative asset paths (Vite: `base: "./"`). The page is served from `tavora-module://<module-id>/`.
- Point the manifest's `entry` at the built HTML file.

### Details over neighbouring panels

Requires Tavora 0.18.18. `tavora.ui.tooltip.show` accepts `TooltipRequest`, a bounded
plain-data description, never HTML or CSS. Use a new id for each hover session,
`move` while the pointer moves, and `hide` on pointer leave. A click may call
`show` with `pinned: true`; `hide` then leaves it open. Call `close` before changing
the source data, and use `onClose` to clear your local pin state. Escape and the
host close button dismiss the current tooltip from anywhere in Tavora.

A card shows "Click to pin item details" in its footer. If your module doesn't pin on click, send
`pinnable: false`: the hint goes away and `pinned: true` is refused. It needs Tavora 0.23.91; the SDK
leaves it out on an older one (check `sdk.supports("ui.tooltip.pinnable")`), where the card still
shows, with the old hint.

Tooltips are neutral (Tavora's own colours) unless `content.look` is `'poe'`, the Path of Exile 2 item look
(Tavora 0.23.53 and newer; an older Tavora rejects a tooltip with `look`, so catch the failure).

`content.layout: 'card'` shows an item card instead: the picture large on top, the title with the badges beside it,
the subtitle as its type line, an effect box (`content.effect`: a text, or runs where `accent: true` ones take the
accent colour), then the stats and sections. A stat can say how much it grows (`per: '+3'`, say per level): the card
then shows a third column in the accent colour, with `content.perHeading` ('Per level', translated) over it, and a stat
with `per` may have an empty `value`. Without any `per` the stats keep two columns. On a Tavora without
`sdk.supports("ui.tooltip.per")` the SDK puts `per` into the value ("12 · +3") and leaves the heading out. A module can dress its cards in a skin of its own, defined once per name with
`ui.tooltip.defineSkin` and picked per card with `content.skin`: a nine-slice frame picture, colours (`#rrggbb`), a WOFF2
font for the title and the effect box only, hard pixels and a title in capitals. Tavora checks the files (only from your
own `dist/`, PNG or WebP and WOFF2 by their first bytes, up to 512 KB each) and the contrast (text, muted text, the
effect box's text and the accent in the box 4.5:1, the accent on the surface 3:1), and refuses a skin that fails with
`INVALID_PARAMS` and the reason. Every size stays Tavora's, and a skin's colours stay the same in every theme. A skin name that isn't defined shows the plain card.
It needs a Tavora with `sdk.supports("ui.tooltip.skin")`; on an older one the SDK leaves `layout` and `skin` out and
puts the effect text into a section row (the card shows in the rich layout), and `defineSkin` does nothing. In a panel, the kit's
`ItemCard` shows the same card.

```ts
await tavora.ui.tooltip.defineSkin('chaos', {
  frame: { image: 'dist/assets/frame-chaos.png', slice: [6, 6, 6, 6] },
  colors: { surface: '#1e1610', text: '#f4e6c8', muted: '#c9b48e', accent: '#f0c86e', box: '#2c2016' },
  font: 'dist/assets/card-font.woff2',
  pixelArt: true,
  titleCaps: true,
});
await tavora.ui.tooltip.show({
  id: 'card:archer', anchor: element, pinnable: false,
  content: { title: 'Archer Tower', subtitle: 'Tower', layout: 'card', skin: 'chaos', image: 'dist/assets/archer.png',
    effect: [{ text: 'Shoots for ' }, { text: '12', accent: true }, { text: ' damage.' }] },
});
```

```ts
await tavora.ui.tooltip.show({
  id: 'item:42', at: { x: event.clientX, y: event.clientY },
  content: { title: 'Example spear', look: 'poe', tone: 'rare',
    sections: [{ rows: [{ text: 'Adds 10 to 22 Physical Damage', badges: ['[P5]'] }] }] },
  pinned: false,
});
```
