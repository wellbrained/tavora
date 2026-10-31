# {{name}}: developing it

A [Tavora](https://mytavora.app) module, made with `@tavora/create-module`. Tavora shows it in a panel of a workspace, next to a game or on its own; it talks to Tavora through [`@tavora/sdk`](https://docs.mytavora.app/api/).

## Develop

```sh
{{run}} install
{{run}} dev
```

`dev` builds the module into `dist/` and builds it again on every change. Leave it running. In Tavora, open **Settings > Developer > Project folders > Add folder…** and choose this folder, or the folder you keep all your module projects in. Add the module to a workspace with **Add module**; its panels reload by themselves after every build.

- `tavora.module.json` is the manifest: its id, name, the panel's smallest size, and what it asks the user for (websites to reach, connectors). See the [manifest reference](https://docs.mytavora.app/reference/manifest).
- `README.md` is your module's description in the catalog. Keep its headings (Features, How to use, Settings, Requirements, Known issues) so pages read alike; see [Publishing](https://docs.mytavora.app/guide/publishing).
- `changelog.json` holds your patch notes, newest version first. Users read them under the module in **Settings > Modules**, marked New after an update, so add an entry whenever you raise `version`.
- `minTavora` is the oldest Tavora the module works with. Raise it when you use something newer from the SDK (the [changelog](https://docs.mytavora.app/reference/changelog) says which Tavora added what).

## Publish

In Tavora, open **Settings > Developer** and press **Publish** next to this module. The first time, Tavora walks you through signing in and choosing a developer name, which sets up your publisher key. Tavora shows what it will publish, can raise `version` and write the patch notes for you, then signs and uploads it. Users find it under **Browse** in the module library.

Tavora publishes what's in `dist/`, so keep `dev` running or run `{{run}} build` first. **Save as zip** next to Publish makes a signed zip to share by hand; users install it with **Settings > Modules > Install from zip**.

Your publisher key signs every version, and the data your module saves for users belongs to it. Tavora keeps it for you, and your recovery key is its backup.

## Publish from CI

To publish from a build server, export your key and make a publish token under **Settings > Developer > Publishing > Publisher keys and CI**. Keep both as secrets there and run:

```sh
{{run}} build
{{exec}} tavora-pack . --key <file>
TAVORA_PUBLISH_TOKEN=<token> {{exec}} tavora-pack publish <zip> --key <file>
```

A token publishes only under id prefixes your account holds, so publish the first version from Tavora, or claim your prefix there.

More in the [developer docs](https://docs.mytavora.app/).
