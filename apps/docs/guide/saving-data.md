# Saving data

Your page has no files of its own to write. Everything it keeps goes through the SDK, and Tavora stores it for your module, per workspace. Pick the kind by what the data is:

| Kind | Use it for | Shared by | Gone when |
| --- | --- | --- | --- |
| `tavora.storage` | Small settings: a filter, a sort order, a counter | All panels of your module in this workspace | The user deletes the module's data |
| `tavora.storage.app` | Settings that should be the same in every workspace | All panels of your module in every workspace | As above |
| `tavora.documents` | The user's work: a plan, a list, a note | All panels of your module in this workspace, with revisions | As above |
| `tavora.blobs` | Pictures too big for a document | All panels of your module in this workspace | The workspace is deleted |
| `tavora.panel` state | Where this one panel is: open tab, scroll position | This panel only | The panel closes |

A module never sees another module's data, or its own data from another workspace (except `storage.app`). Values must be plain JSON: no `Date`, `Map`, `undefined` or typed arrays. The limits are in the [protocol reference](../reference/protocol.md#limits).

## Settings

```ts
const view = (await tavora.storage.get<string>("view")) ?? "list";
await tavora.storage.set("view", "grid");
```

5 MiB per module and workspace, the same again for `storage.app`. Type parameters are not checked, so be ready for a value an older version of your module wrote.

Two panels of your module can change the same setting at once. When that matters, such as a game in progress that every panel moves on, use `compareAndSet` (Tavora 0.21.92 and newer): it sets the value only while the key still holds what you read, and tells you whether it did.

```ts
const run = await tavora.storage.app.get<Run>("run");
const next = { ...run, guesses: [...run.guesses, guess] };
if (!(await tavora.storage.app.compareAndSet("run", run, next))) {
  // Another panel was faster: read "run" again and show that.
}
```

## Documents

A document is a JSON value with a title and a revision, up to 4 MiB each. Use one for anything the user would be sad to lose.

Two panels of your module can be open at once, even in the same workspace, so save with `ifRevision`. Then a save that would overwrite another panel's newer one fails with `CONFLICT` instead:

```ts
let plan = await tavora.documents.get<Plan>("plan");

async function save(data: Plan) {
  try {
    plan = { ...plan, ...(await tavora.documents.put({ id: "plan", title: "Plan", data, ifRevision: plan?.revision ?? 0 })), data };
  } catch (error) {
    if (!(error instanceof TavoraError && error.code === "CONFLICT")) throw error;
    plan = await tavora.documents.get<Plan>("plan"); // someone else saved first: show theirs
    render(plan);
  }
}

tavora.documents.onChange(async ({ id }) => {
  if (id === "plan") render((plan = await tavora.documents.get<Plan>("plan")));
});
```

### The document store

Most modules should not write that by hand. `openDocument` from `@tavora/sdk/store` keeps one document for you: edits show at once, are saved a moment later one after another, and when another panel saved first your edit is applied again on top of its copy, so neither is lost.

```ts
import { openDocument } from "@tavora/sdk/store";

const plan = await openDocument<Plan>(tavora, "plan", {
  parse: (raw) => (raw as Plan | null) ?? { items: [] }, // the document may not exist yet
  title: () => "Plan",
});

plan.onChange(({ data }) => render(data)); // your own edits and other panels'
plan.onError(() => showToast("Couldn't save"));      // `plan.data` is back at the saved copy
plan.update((draft) => void draft.items.push("Milk")); // changes `plan.data` now, saves soon
await plan.flush();                                    // save right away
```

An edit is a function that runs on the newest copy, so write it as "add this item", not "the list is now this". After 5 conflicting attempts the store gives up, calls `onError` and goes back to the saved copy. An editor that owns the whole document can pass `merge: "mine"`: then its copy wins a conflict, and another panel's change while it has unsaved edits only reaches `onChange`. Unsaved edits are saved when the panel is hidden and on `dispose()`. A document is still one `documents.put`, so it stays under 4 MiB. In a Vue module, `useDocument` from `@tavora/official-ui` wraps this.

If you need more control (several documents in one save, or your own conflict handling), use `documents.put` with `ifRevision` as above.

`ifRevision: 0` means "only if it doesn't exist yet". Other panels get `documents.onChange` after each save; the panel that saved does not.

## Pictures

```ts
const info = await tavora.blobs.put(file); // a File or Blob from an <input> or a paste
img.src = tavora.blobs.url(info.id);
```

PNG, JPEG, GIF and WebP only, up to 50 MB each and 500 MB per module and workspace. Keep the returned `id` in a document. Tavora picks the ids; you never name a file.

## Panel state

```ts
await tavora.panel.setState({ tab: "gear", scroll: 120 });
const state = await tavora.panel.getState<{ tab: string }>();
```

Up to 256 KiB, and it goes away when the user closes the panel. Use it so a panel looks the same after Tavora restarts, not for anything the user made.

## Save as you go

Save when something changes, not when the panel closes. `lifecycle.onDispose` may never arrive: Tavora can quit, crash or remove the panel without it. Writes are atomic, so a crash leaves the old or the new value, never half of one.

## Whose data it is

Data belongs to your module's id together with who published it: the key that signed the zip, or "local" for an unsigned folder. So:

- Your development folder and your signed zip don't see each other's data, even with the same id.
- An update signed with the same key keeps everything the user saved.
- A zip signed with a different key starts empty. That is why [your publisher key](./publisher-key.md) matters.

## Testing what you save

`@tavora/sdk/testing` keeps documents, settings and panel state in memory with Tavora's revisions, limits and errors, so you can test saving without Tavora. See [Testing your module](testing.md).
