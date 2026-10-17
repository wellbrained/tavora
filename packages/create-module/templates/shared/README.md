# {{name}}

A [Tavora](https://mytavora.app) module, made with `@tavora/create-module`. Tavora shows it in a panel next to a game; it talks to Tavora through [`@tavora/sdk`](https://docs.mytavora.app/api/).

## Develop

```sh
{{run}} install
{{run}} dev
```

`dev` builds the module into `dist/` and builds it again on every change. In Tavora, open **Settings > Modules > Add a development folder** and choose this folder. Add the module to a game with **Add module**; its panels reload by themselves after every build.

- `tavora.module.json` is the manifest: its id, name, the panel's smallest size, and what it asks the player for (websites to reach, connectors). See the [manifest reference](https://docs.mytavora.app/reference/manifest).
- `minTavora` is the oldest Tavora the module works with. Raise it when you use something newer from the SDK (the [changelog](https://docs.mytavora.app/reference/changelog) says which Tavora added what).

## Share

```sh
{{run}} build
{{run}} zip
```

`zip` packs the built module into `{{id}}-0.1.0.zip`, signed with your publisher key. The first run makes the key in `~/.tavora/publisher-key.pem`. **Back it up and never share it**: the data your module saves for players belongs to that key, so a new key means a new publisher. Players install the zip with **Settings > Modules > Install from zip**; a newer zip signed with the same key updates it.

## Show your name instead of a fingerprint

In Tavora, sign in under **Settings > Account**, choose a developer name under **Module developer** and press **Link a publisher key**. Then run the command it shows here, for example:

```sh
{{exec}} tavora-pack link ABCD-EFGH
```

Players then see your modules as "by" your name.

More in the [developer docs](https://docs.mytavora.app/).
