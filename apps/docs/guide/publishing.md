# Publishing to the catalog

Tavora's module catalog is where players find community modules: under **Browse** in the module library, for the game they have open or for a personal workspace. Publishing puts your module there, and every player who installs it from the catalog gets your updates on their own.

## Before the first upload

1. **Sign in and make your key.** Publishing needs a Tavora account (email or Discord) with your publisher key linked to it. Choose a developer name under Settings > Account, then press **Make a key** as [Your publisher key](./publisher-key.md#where-it-is) shows; Tavora links it. Players see that name as "by *your name*" next to your module.
2. **Pick an id with your own prefix.** The part of your module id before the first dot is your prefix, such as `wellbrained` in `wellbrained.timer`. The first time you publish under a free prefix, it becomes your account's, and nobody else can publish under it. An account holds up to 3 prefixes. Words a developer name couldn't be are refused, such as `tavora`, `official` and `local`, so an id from the starter (`local.…`) needs a new prefix first. Prefixes stay taken when an account is deleted.
3. **Say where the module belongs.** `games` lists the games it is made for, or stays empty for any game. A module for any game is offered in personal workspaces too, unless you set `workspaces` to `false`. See the [manifest reference](../reference/manifest.md).
4. **Write a description and patch notes.** The listing shows your manifest's `name`, `description`, `version` and what it asks for (`permissions.network` and `connectors`), next to the zip's size. Each version's lines from [`changelog.json`](./getting-started.md#patch-notes) show up as its patch notes. All of it is shown as plain text, never HTML or Markdown.
5. **Fill your module's page** if you like. `readme` names a `README.md` (or `.txt`) introducing your module, `screenshots` up to 5 PNG or WebP pictures, and `homepage` your module's web page. Your `icon` shows on the catalog card. Players see all of it when they open your module in the catalog. Set `minTavora` to at least `0.18.19` when you use `readme`, and `0.18.17` for the others.
6. **Set `minTavora`** if the module uses something from a newer SDK. The [SDK changelog](../reference/changelog.md) says which Tavora each feature needs.

## Publish

Build, pack and publish with the same key:

```sh
npm run build
npm run zip
npx tavora-pack publish <id>-<version>.zip
```

`publish` checks that the zip is signed by your key, then asks Tavora to sign its SHA-256 with the same key (press **Allow**) and uploads it with that signature. Your secret key never leaves Tavora. From CI, pass `--key <file>` with an [exported key](./publisher-key.md#publishing-from-ci).

The service checks the zip the way Tavora's installer does: the size and compression limits, the manifest and every file it names, that each screenshot really is a PNG or WebP within the limits, the changelog and the signature over every file. A zip that passes is listed at once. There's no review before listing; a person at Tavora looks only at modules players report.

## What players see

- **Browse** lists your module with its name, version, "by *your name*", its description, its size and what it asks for. Before they install, players can see the network hosts and connectors it wants.
- **Your module's page** opens from its card: your icon, readme, screenshots and homepage, this version's patch notes, when it was updated and what it can reach. The readme shows headings, paragraphs, lists and code as plain text; links show only their words. There are no download counts, because Tavora doesn't track who installs what.
- **Install** downloads the zip, checks it against the listing and your key's signature, and installs it like Install from zip. Installing grants nothing: players are asked for your network hosts and connectors when they add the module, as with any zip.
- Their data and permissions belong to your module id and your key, as [Your publisher key](./publisher-key.md#what-the-key-decides) explains.

## Updates

Raise `version` in `tavora.module.json`, add its patch notes, then build, pack and publish again with the same key. Each new version must be higher than the last one you published.

While online features are on, players' Tavora looks for updates a little after start, every few hours after that, and when they press **Check for updates** in Settings > Modules:

- An update that asks for nothing new installs at once. Open panels reload with it, and players get a notice pointing to your patch notes.
- An update that asks for a network host or connector the installed version didn't ask for waits for the player's yes. The installed version keeps running until they allow it, and the patch notes show in the dialog.
- Every player gets the latest version. There's no way to pin an older one, and an older or equal version can't be published.

A zip a player installed by hand with Install from zip isn't updated from the catalog. Once they install your module from Browse, it is.

## Limits

An account can publish 10 versions a day and keep 200 MB of zips in the catalog. One upload is at most 50 MB. If an upload is refused, `tavora-pack publish` says why:

| Message | What to do |
| --- | --- |
| Your publisher key is not linked to a Tavora account yet | Press **Link** next to it in Settings > Account > Module developer. A key file: **Get a link code**, then `tavora-pack link <code> --key <file>`. |
| Another developer publishes under this id prefix | Give the module an id with a prefix of your own. |
| This id prefix is reserved | Pick another prefix; reserved words such as `tavora` and `local` are refused. |
| Your account already publishes under 3 id prefixes | Use one of the prefixes you have. |
| … already has 1.2.0; a new version must be newer | Raise `version`. Also shown when another key published the module's first version. |
| Your account has published as many versions as it can today | Wait a day. |
| Your modules take as much room in the catalog as an account may have | Make the zip smaller. |
| The zip was refused: … | The zip failed a check; the message names it. |

## Reports and takedowns

Players can report a module from Browse, or from Settings > Modules once it is installed. A report names only the module, your key and the zip, never the player, and hides nothing by itself: a person at Tavora looks at it. When your account has an email address, you get an email at most once a day saying your module was reported. Reports carry no sender, so there's nobody to answer.

If the module breaks the rules, Tavora can take it out of the catalog (players who installed it keep it), block a zip so it stops on every player's PC with their data kept, or revoke a key. A blocked module comes back only with a new version whose zip isn't blocked.

## A lost or leaked key

Tavora can hand your modules to a new key, but only if the old key was linked to your account. It signs a statement, offline with its own key, that the new key replaces the old one. Players' Tavora then takes updates signed by the new key for the old key's modules, and their data stays where it was.

- **Leaked:** make a new key, link it to the same account, and ask Tavora to revoke the old key and move your modules to the new one. Ask by email to [tavora.app@gmail.com](mailto:tavora.app@gmail.com), from the address your account uses if it has one. A revoked key can't publish or install anything new. Modules players already have keep running, and so do the zips Tavora lists as published before the revocation.
- **Lost:** make a new key the same way, and email the same address to ask for the move. Keys Tavora keeps are lost only with your recovery key.

Once Tavora has signed the statement, publish new versions of your modules with the new key as usual. The catalog takes them because the statement names your account, and players' Tavora updates to them and keeps their data.

A key that was never linked can't be replaced. That's one more reason to [link yours now](./publisher-key.md#show-your-name).
