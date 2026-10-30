# Several panels

A module can offer more than one tool, each as a panel of its own. A build planner for an action RPG might have a Passive tree, a Skills list and a Gear panel. Users add each from the module library, dock them wherever they like and open copies side by side. This guide walks through such a module. Every field and call is in the [manifest](../reference/manifest.md#panel-types) and [protocol](../reference/protocol.md#content-per-panel) references. The Panel Types Example in Tavora's examples folder runs all of it.

Needs Tavora 0.17.18 or newer for everything here, so set `minTavora` to at least `0.17.18`.

## Declare the panel types

```json
"entry": "dist/index.html",
"icon": "dist/icons/tree.png",
"viewport": { "minWidth": 320, "minHeight": 240 },
"panels": [
  { "id": "tree", "name": "Passive tree", "viewport": { "minWidth": 640, "minHeight": 480 } },
  { "id": "skills", "name": "Skills", "icon": "dist/icons/skills.png" },
  { "id": "gear", "name": "Gear", "icon": "dist/icons/gear.png" }
]
```

- `id` is how Tavora remembers every open panel and saved layout. Never change it after release. `name` is only the tab's label and may change.
- A type takes the module's `entry`, `icon` and `viewport` unless it sets its own. One page can serve all types: ask `tavora.panel.type` and show the right tool. Separate pages per type work just as well.
- Adding a `panels` list to a module that had none? Mark the type its old panels should become with `"continues": true`, so users keep their layout and panel state.
- When an update removes a type, its open panels stay where they are and say so, until the user removes them or picks another type. Prefer keeping a type over removing it.

```ts
const tavora = await connect();
if (tavora.panel.type === "tree") showTree();
else if (tavora.panel.type === "skills") showSkills();
else showGear();
```

## Share data between the panels

All panels of a module, of every type, share its `storage`, `documents` and `blobs` in the current workspace. Keep the user's work in documents, one per build, and every panel sees the same build:

```ts
const build = await tavora.documents.get<Build>(buildId);

tavora.documents.onChange(async ({ id }) => {
  if (id === buildId) render(await tavora.documents.get<Build>(buildId));
});
```

When the Skills panel saves a new gem, the Passive tree and Gear panels hear about it through `documents.onChange` and redraw. Save with `ifRevision` so two panels never overwrite each other; [Saving data](./saving-data.md#documents) shows how. Only `panel` state (`panel.getState` and `panel.setState`) belongs to one panel.

## Let each panel show its own build

A user may want two Gear panels, one per build, side by side. Each panel then keeps its own choice and tells Tavora what it shows.

```ts
const launch = await tavora.panel.getLaunch();
if (launch.reason === "restore") {
  // Open before (a restart, a workspace switch, a reload): show what it showed.
  buildId = (await tavora.panel.getState<{ build: string }>())?.build ?? launch.content?.id ?? null;
} else if (launch.reason === "open") {
  // Another panel opened this one on a build (see below).
  buildId = launch.content?.id ?? null;
} else {
  // Just added: start on the build used last.
  buildId = (await tavora.storage.get<string>("lastBuild")) ?? null;
}
await show(buildId);

async function show(id: string | null) {
  buildId = id;
  await tavora.panel.setState(id ? { build: id } : null);
  const build = builds.find((item) => item.id === id);
  await tavora.panel.setContent(build ? { id: build.id, title: build.title } : null);
  render(build);
}
```

- Most modules do not write this by hand: the [item session](./saving-data.md#items-a-list-and-the-one-that-is-open) lists the items, restores, calls `panel.setContent` and follows `panel.onNavigate` for you.
- Call `panel.setContent` every time the selection changes. Tavora keeps it with the panel and shows the title when the user hovers the tab, so two Gear tabs can be told apart.
- Put a build selector in the panel's toolbar. Shorten long titles there and show the full name on hover.
- When a panel's build is deleted, keep the panel open: say so where the build was and keep the selector. Never switch to another build by yourself.

## Open one panel from another

A button in the Passive tree, "Show gear", can bring up the Gear panel on the same build. Call `panels.open` from the click itself:

```ts
gearButton.addEventListener("click", async () => {
  const build = builds.find((item) => item.id === buildId);
  const result = await tavora.panels.open("gear", build ? { content: { id: build.id, title: build.title } } : {});
  // "shown", "switched", "opened" or "failed"
});
```

Tavora picks the panel, in this order:

1. A Gear panel that already shows this build comes to the front.
2. Else the Gear panel the user used last is asked to switch to it.
3. Else, or when that panel's page has no `onNavigate` handler, a new Gear panel opens. Its `panel.getLaunch()` answers `{ reason: "open", content }`.

Every page that can switch builds handles the request:

```ts
tavora.panel.onNavigate(async (content) => {
  await saveEdits(); // throw if this fails: the panel keeps its build and edits
  await show(content.id);
});
```

The handler has 5 seconds. When it throws or runs out of time, the panel stays as it was, and Tavora offers the user the build in a new panel instead. Without a handler, Tavora always opens a new panel. Save before you switch, never lose an edit.

`panels.open` only works right after a click or key press in the panel, once per click, and only opens your own module's panel types in the current workspace. Called on its own, it fails with `PERMISSION_DENIED`.

## Checklist

- Every type has an `id` you will keep forever.
- The user's work lives in documents, and each panel redraws on `documents.onChange`.
- Each panel keeps its own selection in `panel` state and reports it with `panel.setContent`.
- Every page handles all three `getLaunch` reasons.
- Pages that switch content have an `onNavigate` handler that saves first.
- `panels.open` is only called from a click or key press.
