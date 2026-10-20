# {{name}}

A [Tavora](https://mytavora.app) module, made with `@tavora/create-module`. Tavora shows it in a panel next to a game; it talks to Tavora through [`@tavora/sdk`](https://docs.mytavora.app/api/).

## Develop

```sh
{{run}} install
{{run}} dev
```

`dev` builds the module into `dist/` and builds it again on every change. Leave it running. In Tavora, open **Settings > Development > Add a development folder…** and choose this folder, or the folder you keep all your module projects in. Add the module to a game with **Add module**; its panels reload by themselves after every build.

- `tavora.module.json` is the manifest: its id, name, the panel's smallest size, and what it asks the player for (websites to reach, connectors). See the [manifest reference](https://docs.mytavora.app/reference/manifest).
- `changelog.json` holds your patch notes, newest version first. Players read them under the module in **Settings > Modules**, marked New after an update, so add an entry whenever you raise `version`.
- `minTavora` is the oldest Tavora the module works with. Raise it when you use something newer from the SDK (the [changelog](https://docs.mytavora.app/reference/changelog) says which Tavora added what).

## Share

```sh
{{run}} build
{{run}} zip
```

`zip` packs the built module into `{{id}}-0.1.0.zip`, signed with your publisher key. Tavora keeps the key: make one under **Settings > Account > Module developer**, keep Tavora open while you pack, and press **Allow** when it asks. The data your module saves for players belongs to that key, so a new key means a new publisher; your recovery key is its backup. Players install the zip with **Settings > Modules > Install from zip**; a newer zip signed with the same key updates it.

## Show your name instead of a fingerprint

Choose a developer name under **Module developer** in Tavora before you make the key. Tavora links the key to your account, so players see your modules as "by" your name.

To pack on a build server, which can't press Allow, export the key in Tavora, keep it as a secret there and run:

```sh
{{exec}} tavora-pack . --key <file>
```

More in the [developer docs](https://docs.mytavora.app/).
