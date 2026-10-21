# Publishing to the catalog

Tavora's module catalog is where players find community modules: under **Browse** in the module library. Browse lists every module, those for the game they have open (or for a personal workspace) first; the others show which game they are for and can't be installed there. Publishing puts your module there, and every player who installs it from the catalog gets your updates on their own.

## Before the first upload

1. **Set up once.** Under **Settings > Development**, the **Want to make modules?** card walks you through signing in (email or Discord), your developer name and your publisher key; Tavora makes the key, keeps it and links it to your account. Players see your name as "by *your name*" next to your module. Pressing Publish before that opens the same steps.
2. **Pick an id with your own prefix.** The part of your module id before the first dot is your prefix, such as `wellbrained` in `wellbrained.timer`. Tavora suggests one from your developer name: press **Check**, then **Claim it** when it's free, during setup or on the review screen. Once it's yours, nobody else can publish under it. An account holds up to 3 prefixes. Words a developer name couldn't be are refused, such as `tavora`, `official` and `local`, so an id from the starter (`local.…`) needs a new prefix; the review screen lets you change it before the first publish. Prefixes stay taken when an account is deleted.
3. **Say where the module belongs.** `games` lists the games it is made for, or stays empty for any game. A module for any game is offered in personal workspaces too, unless you set `workspaces` to `false`. See the [manifest reference](../reference/manifest.md).
4. **Write a description and patch notes.** The listing shows your manifest's `name`, `description`, `version` and what it asks for (`permissions.network` and `connectors`) and the zip's size. Each version's lines from [`changelog.json`](./getting-started.md#patch-notes) show up as its patch notes. All of it is shown as plain text, never HTML or Markdown.
5. **Fill your module's page** if you like. `readme` names a `README.md` (or `.txt`) introducing your module, `screenshots` up to 5 PNG or WebP pictures, and `homepage` your module's web page. Your `icon` shows on the catalog card. Players see all of it when they open your module in the catalog. Set `minTavora` to at least `0.18.19` when you use `readme`, and `0.18.17` for the others.
6. **Set `minTavora`** if the module uses something from a newer SDK. The [SDK changelog](../reference/changelog.md) says which Tavora each feature needs.

## Publish

Build the module (`npm run dev` keeps `dist/` up to date), then press **Publish** on it in **Settings > Development** or in its menu in the module library. Tavora packs the folder as it is and opens a review screen:

- the name, icon, version and this version's patch notes
- what the module asks for: network hosts and connectors
- the zip's size and how old the build is, with a warning when your sources changed after the last build
- whether it's the first version or an update, and from which version

If something blocks the upload, the screen says what and offers the fix: buttons for the next version and a box for its patch notes (Tavora writes both into `tavora.module.json` and `changelog.json`), the prefix to check and claim, or "Run npm run dev or npm run build first."

Press **Publish** on the review screen to sign the zip with your key and upload it with your sign-in. That press is your yes; nothing else asks. Your secret key never leaves Tavora, and the key alone can't publish: the service also checks that the account signed in is the one the key is linked to.

Every upload sends an email to your account's address, naming the module, the version and whether it came from Tavora or which publish token. If you didn't publish it, write to [tavora.app@gmail.com](mailto:tavora.app@gmail.com) right away.

The service checks the zip the way Tavora's installer does: the size and compression limits, the manifest and every file it names, that each screenshot really is a PNG or WebP within the limits, the changelog and the signature over every file. A zip that passes is listed at once. There's no review before listing; a person at Tavora looks only at modules players report.

## What players see

- **Browse** lists your module with its name, version, "by *your name*", its description, whether it works where the player is, and how many times it was installed from Browse. Installs are counted per module only, with nothing about who installed it; updates don't count.
- **Your module's page** opens from its card: your icon, readme, screenshots and homepage, this version's patch notes, when it was updated and what it can reach. The readme shows headings, paragraphs, lists and code as plain text; links show only their words. The page also shows the network hosts and connectors it wants, so players see them before they install.
- **Install** downloads the zip, checks it against the listing and your key's signature, and installs it like Install from zip. Installing grants nothing: players are asked for your network hosts and connectors when they add the module, as with any zip.
- Their data and permissions belong to your module id and your key, as [Your publisher key](./publisher-key.md#what-the-key-decides) explains.

## Updates

Build, then press **Publish** again. The review screen raises `version` and adds the patch notes if you haven't yet. Each new version must be higher than the last one you published, and it's signed with the same key.

While online features are on, players' Tavora looks for updates a little after start, every few hours after that, and when they press **Check for updates** in Settings > Modules:

- An update that asks for nothing new installs at once. Open panels reload with it, and players get a notice pointing to your patch notes.
- An update that asks for a network host or connector the installed version didn't ask for waits for the player's yes. The installed version keeps running until they allow it, and the patch notes show in the dialog.
- Every player gets the latest version. There's no way to pin an older one, and an older or equal version can't be published.

A zip a player installed by hand with Install from zip isn't updated from the catalog. Once they install your module from Browse, it is.

## Limits

An account can publish 10 versions a day and keep 200 MB of zips in the catalog. One upload is at most 50 MB. The review screen shows most problems before you press Publish. When the service refuses an upload, Tavora (or `tavora-pack publish`, from CI) says why:

| Message | What to do |
| --- | --- |
| Publishing needs your Tavora account | Publish from Tavora, or from CI with a key file and a publish token in `TAVORA_PUBLISH_TOKEN`. |
| This publisher key is linked to another Tavora account | Sign in to Tavora with the account the key is linked to, or use that account's publish token. |
| A publish token publishes only under id prefixes your account has | Publish the module's first version from Tavora, or claim the prefix there first. |
| Your publisher key is not linked to a Tavora account yet | Press **Link** next to it in Settings > Development. A key file: **Get a link code** under Publish from CI, then `tavora-pack link <code> --key <file>`. |
| Another developer publishes under this id prefix | Give the module an id with a prefix of your own. |
| This id prefix is reserved | Pick another prefix; reserved words such as `tavora` and `local` are refused. |
| Your account already publishes under 3 id prefixes | Use one of the prefixes you have. |
| … already has 1.2.0; a new version must be newer | Raise `version` (the review screen does it for you). Also shown when another key published the module's first version. |
| Your account has published as many versions as it can today | Wait a day. |
| Your modules take as much room in the catalog as an account may have | Make the zip smaller. |
| The zip was refused: … | The zip failed a check; the message names it. |

## Publish from CI

A build server can publish too, with the `@tavora/pack` command line tool. It needs two secrets from **Settings > Development > Publish from CI**:

1. **Your key as a file.** Press **Export** next to the key and save it. Pass it with `--key <file>`.
2. **A publish token.** Type a name (like "GitHub Actions") and press **Make a token**. Copy it right away: Tavora shows it only once. Put it in the `TAVORA_PUBLISH_TOKEN` environment variable.

```sh
npm run build
npx @tavora/pack . --key publisher-key.pem
TAVORA_PUBLISH_TOKEN=tvp_… npx @tavora/pack publish <id>-<version>.zip --key publisher-key.pem
```

A token publishes only under id prefixes your account already holds, so publish the first version from Tavora, or claim your prefix there first. It works for a year, only together with a key linked to your account. You get an email for every upload, naming the token. Remove a token you don't need any more, and it stops working at once.

**With the file and a token, anyone can publish as you.** Keep both as CI secrets, never commit them, and export the key only where you need it.

## Reports and takedowns

Players can report a module from its page in Browse, or from Settings > Modules once it is installed. A report names only the module, your key and the zip, never the player, and hides nothing by itself: a person at Tavora looks at it. When your account has an email address, you get an email at most once a day saying your module was reported. Reports carry no sender, so there's nobody to answer.

If the module breaks the rules, Tavora can take it out of the catalog (players who installed it keep it), block a zip so it stops on every player's PC with their data kept, or revoke a key. A blocked module comes back only with a new version whose zip isn't blocked.

## A lost or leaked key

Tavora can hand your modules to a new key, but only if the old key was linked to your account. It signs a statement, offline with its own key, that the new key replaces the old one. Players' Tavora then takes updates signed by the new key for the old key's modules, and their data stays where it was.

Ask in the app: Settings > Development, then **Lost it?** next to the key under your publisher keys.

- **I lost it:** your modules move to your newest key that Tavora keeps and that is linked to your account. If there is none, Tavora makes one and links it. Keys Tavora keeps are lost only with your recovery key.
- **It was leaked:** the same, and Tavora also revokes the old key. From the moment you ask, the catalog takes nothing new signed by it. Once revoked, it can't publish or install anything new. Modules players already have keep running, and so do the zips Tavora lists as published before the revocation.

Your account's email address gets a note that you asked. The key shows **Waiting for Tavora** until a person at Tavora has checked the request and signed it, then **Done**. Both keys stay linked while it waits. If something can't be done in the app, write to [tavora.app@gmail.com](mailto:tavora.app@gmail.com).

**A publish token leaked?** Remove it under Settings > Development > Publish from CI. It stops working at once. A token alone can't publish; it needs your key too.

Once Tavora has signed the statement, publish new versions of your modules with the new key as usual. The catalog takes them because the statement names your account, and players' Tavora updates to them and keeps their data.

A key that was never linked can't be replaced. That's one more reason to [link yours now](./publisher-key.md#show-your-name).
