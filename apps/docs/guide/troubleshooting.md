# Troubleshooting

## The module doesn't show up

Open **Settings > Development**. Each development folder lists its projects, and a project that didn't load says why and what to do. (Modules in your modules folder that didn't load are listed in **Settings > Modules**.)

- **"No module here"**: add the project folder (the one with `tavora.module.json`), or the folder that has your projects directly inside it, not a project's `src` or `dist`.
- **A manifest error**, such as an unknown field or a wrong `id`: Tavora refuses manifests with mistakes rather than guessing. Add `"$schema": "https://docs.mytavora.app/schema/tavora.module.schema.json"` and your editor shows the problem. The fields are in the [manifest reference](../reference/manifest.md).
- **"Not built yet"**: run `npm run dev` in that project and leave it running; the module loads by itself once `dist/index.html` is there.
- **"another module with the same id is already loaded"**: a development folder wins over an installed module with the same id, so the installed copy is the one that waits. Remove one of them, or use another id while you test.
- **It needs a newer Tavora**: your `minTavora` is newer than the Tavora you run. Update Tavora, or lower `minTavora` if you don't use the newer features.

## The panel is empty or broken

When the page crashes or stops responding, the panel says so and offers **Reload**. When it just stays empty, it is usually one of these:

- **Absolute paths.** The page is served from `tavora-module://<module id>/`, so `/assets/app.js` points nowhere. Use relative paths; in Vite that is `base: "./"` (the starter sets it).
- **Anything from the internet.** Your page can't load CDN scripts, web fonts or remote images, and its own `fetch` is blocked. Bundle everything; reach web APIs with [`tavora.network.fetch`](./permissions.md).
- **Opened in a browser.** Outside Tavora, `connect()` rejects with `HOST_UNAVAILABLE` after 5 seconds. Test inside Tavora with a development folder.
- **`INCOMPATIBLE`**: this Tavora speaks another bridge protocol version than your SDK. Update Tavora.

## Changes don't appear

- Keep `npm run dev` running: it rebuilds on every change, and Tavora reloads the module's open panels when the build changes. A change to `tavora.module.json` makes Tavora read the module again.
- Tavora watches the project folder and its build folder. If your build writes somewhere else, point the manifest's `entry` there.
- Still old? Remove the development folder in Settings > Development and add it again.

## A call fails

Check `error.code`, not the message. The codes are in the [protocol reference](../reference/protocol.md#errors); the common ones:

| Code | Usually |
| --- | --- |
| `PERMISSION_DENIED` | The player hasn't granted that host or connector, or a [call that needs a click](./permissions.md#calls-that-need-a-click) wasn't made from one. `error.capability` says which grant is missing. |
| `INVALID_PARAMS` | A value that isn't plain JSON (a `Date`, `undefined`, a `Map`), a wrong id, or a field the call doesn't take. |
| `QUOTA_EXCEEDED` | Over a [limit](../reference/protocol.md#limits); for big pictures use `blobs`. |
| `CONFLICT` | Another panel saved the document first. See [Saving data](./saving-data.md#documents). |
| `NETWORK_ERROR` | `network.fetch` got no answer: offline, unknown host, bad certificate or over 15 seconds. |
| `TIMEOUT` | No answer within 10 seconds. |

## Packing can't sign

- **"Open Tavora on this PC"**: `tavora-pack` asks Tavora to sign. Start Tavora, sign in, and pack again. From CI, pass an [exported key](./publisher-key.md#publishing-from-ci) with `--key <file>`.
- **"Tavora has no publisher key yet"**: press **Make a key** in Settings > Account > Module developer.
- **"doesn't have your recovery key yet"**: type it in under Settings > Account > Module developer.
- **"the request was turned down"**: you pressed Turn down, or nobody answered within 2 minutes. Pack again and press **Allow**.
- **"more than one publisher key"**: pick one with `--publisher <fingerprint>`.

## Installing the zip fails

- **"comes from a different publisher, so it can't replace it"**: the zip is signed with another key than the installed version. Sign it with your original key; see [Your publisher key](./publisher-key.md).
- **"An update needs a higher version"**: the zip has the same or a lower `version` than the installed one. Raise `version` in `tavora.module.json`, build and zip again.
- **"is loaded from your development folder"**: Tavora is loading the same module from its project folder. Remove that development folder in Settings > Development, then install the zip.
- **"is already loaded from …"**: the same id is loaded from another folder. Remove it there first.
- **"comes with Tavora"**: your module uses the id of one that ships with Tavora. Give it its own id.
- **"needs Tavora … or newer"**: the player has to update Tavora first.
- **"can't be read as a module zip"**: make the zip with `npm run zip` (`tavora-pack`), not by hand.

## Still stuck?

Ask on GitHub: open an [issue for module developers](https://github.com/wellbrained/tavora/issues/new?template=module-developer.yml) for a bug, or start a [discussion](https://github.com/wellbrained/tavora/discussions) for a question. Say which Tavora and `@tavora/sdk` version you use, and what Settings > Modules shows. Security problems go privately, as the [security policy](https://github.com/wellbrained/tavora/blob/main/SECURITY.md) says.
