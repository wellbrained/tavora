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

plan.onChange(({ data }) => render(data)); // your own edits, other panels' and rollbacks
plan.onError((error, kind) => kind === "save" && showToast("Couldn't save")); // "change" and "reload" roll nothing back
plan.update((draft) => void draft.items.push("Milk")); // changes `plan.data` now, saves soon
await plan.flush();                                    // save right away
if (plan.status === "error") showToast("Couldn't save"); // flush never throws; onError is the reliable signal
```

An edit is a function that runs on the newest copy, so write it as "add this item", not "the list is now this". It runs again on a newer copy when another panel saved first, so make ids and timestamps outside of it (`const id = crypto.randomUUID()`, then `update((draft) => void draft.items.push({ id, ... }))`), or each run makes new ones. What you see is what is saved, until a conflict makes the store apply your edits again; after that `data` is the re-applied copy. An edit that throws on the newest copy is dropped and reported to `onError` (second argument `"change"`); the other edits stay.

`status` is `"idle"`, `"dirty"` (edits not saved yet), `"saving"` or `"error"` (the last save failed, until the next edit). Calling `flush()` or the panel being hidden with nothing to save does not change it.

When a save gives up (after 5 conflicting attempts, or any other error), `onError` fires with `"save"`, `data` goes back to the saved copy and an `onChange` event with `source: "rollback"` says so (an editor that ignores its own events must adopt it). Edits made while that save ran are kept and saved next. Because they are saved in the same run, `status` can already be `"idle"` again when `flush()` resolves, so listen to `onError` rather than only checking `status`. A failed reload of another panel's change goes to `onError` as `"reload"`; nothing is rolled back.

When another panel deletes the document, `onChange` gets `deleted: true`. Your unsaved edits stay, but nothing is saved until your next `update` or `flush()`, which creates the document again; `dispose()` does not. A `flush()` that was already running then resolves with the edits still waiting. A panel that must not bring it back can drop its edits instead.

An editor that owns the whole document can pass `merge: "mine"`:

- Its copy wins a conflict.
- Another panel's change while it has unsaved edits only reaches `onChange`, with the other copy in `event.remote`; `await plan.adoptRemote()` drops your edits and shows that copy ("load theirs"); if your own save had already gone over it, theirs is saved back as a new revision.
- A failed save does not roll back: your work stays on screen, `status` is `"error"`, `onError` fires, and the next `flush()` or `update` tries again.

Unsaved edits are saved when the panel is hidden and on `dispose()`. A document is still one `documents.put`, so it stays under 4 MiB. In a Vue module, `useDocument` from `@tavora/official-ui` wraps this; an edit made before it has loaded is dropped if the panel closes first or the document can't be read (`error` says why).

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
