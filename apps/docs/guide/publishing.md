# Publishing to the catalog

Tavora's module catalog is where users find community modules: under **Browse** in the module library. Browse lists every module, those for the workspace they have open first (a game workspace gets the modules for its game, a personal workspace those for any game); the others show which game they are for and can't be installed there. Publishing puts your module there, and every user who installs it from the catalog is told when you publish an update.

## Before the first upload

1. **Set up once.** Under **Settings > Development**, the **Want to make modules?** card walks you through signing in (email or Discord) and choosing a developer name. Saving the name makes your publisher key, links it to your account and claims your name as your prefix. Users see your name as "by *your name*" next to your module. Pressing Publish before that opens the same steps.
2. **Use an id with your own prefix.** The part of your module id before the first dot is your prefix, such as `wellbrained` in `wellbrained.timer`. Once it's yours, nobody else can publish under it. An account holds up to 3 prefixes: **Add another** under Module developer checks one and claims it. Words a developer name couldn't be are refused, such as `tavora`, `official` and `local`, so an id from the starter (`local.…`) needs your prefix; the review screen lets you change the id before the first publish. Prefixes stay taken when an account is deleted, and a prefix that already has a module from another developer is taken even if nobody claimed it.
3. **Say where the module belongs.** `games` lists the games it is made for, or stays empty for any game. A module for any game is offered in personal workspaces too, unless you set `personalWorkspaces` to `false`. See the [manifest reference](../reference/manifest.md).
4. **Write a description and patch notes.** The listing shows your manifest's `name`, `description`, `version` and what it asks for (`permissions.network` and `connectors`) and the zip's size. Each version's lines from [`changelog.json`](./getting-started.md#patch-notes) show up as its patch notes. It is shown as plain text, never HTML.
5. **Fill your module's page** if you like. `readme` names a `README.md` (or `.txt`) that becomes the module's description (see [Writing the description](#writing-the-description)), `screenshots` up to 5 PNG or WebP pictures, `homepage` your module's web page, and `support` an `https` address or an email address for feedback (it shows as a **Send feedback** button; leave it out for no button). Your `icon` shows on the catalog card. Users see all of it when they open your module in the catalog. Set `minTavora` to at least `0.20.39` when you use `support`, `0.18.19` when you use `readme`, and `0.18.17` for the others.
6. **Set `minTavora`** if the module uses something from a newer SDK. The [SDK changelog](../reference/changelog.md) says which Tavora each feature needs.

## Writing the description

The page sorts your readme into the same sections every module has, so pages read alike. The text before the first heading is the **Overview**. After it, Tavora looks for these headings (any capitalisation; German names work too) and always shows them in this order, whatever order you wrote them in:

| Heading | German | What goes in it |
| --- | --- | --- |
| *(no heading)* | | Overview: one or two sentences on what the module does |
| `## Features` | Funktionen | What it can do |
| `## How to use` | Bedienung | The first steps |
| `## Settings` | Einstellungen | What users can change |
| `## Requirements` | Voraussetzungen | A game, an account, the internet |
| `## Known issues` | Bekannte Probleme | What doesn't work yet |

Any other heading goes at the end under **More**. A readme without these headings still shows fine. A title on the very first line (`# My module`) is left out, since the page already shows the name. `npm create @tavora/module` writes a `README.md` in this shape. Bold, italic, `code` and links (`[words](https://…)`, `http` or `https` only) work, and a list item can have one level of items under it.

The **Publish** review shows the description as it will appear, with a tip when it has no Overview or Features. Tips never stop a publish.

## Publish

Build the module (`npm run dev` keeps `dist/` up to date), then press **Publish** next to it in **Settings > Development**, or in its menu in Add module. Tavora packs the folder as it is and opens a review screen:

- the name, icon, version and this version's patch notes
- your description as the catalog page will show it
- what the module asks for: network hosts and connectors
- when it was built, with a warning when you changed files after the last build
- whether it's the first version or an update, and from which version

If something blocks the upload, the screen says what and offers the fix:

- **The catalog has this version already:** pick the next one (Fixes, New features or Big changes), add its patch notes, and press **Save to project**. Tavora writes both into `tavora.module.json` and `changelog.json`.
- **The version is a test version** (a pre-release such as `0.2.0-beta.1`): pick a plain one the same way. Module versions are always `major.minor.patch`.
- **The id doesn't start with one of your prefixes:** type a new id and press **Use it**. A prefix you don't hold yet is claimed when you publish.
- **Nothing is built yet:** run `npm run build`, then press **Check again**.

Press **Publish** on the review screen to sign the zip with your key and upload it with your sign-in. That press is your yes; nothing else asks. Your secret key never leaves Tavora, and the key alone can't publish: the service also checks that the account signed in is the one the key is linked to.

Every upload sends an email to your account's address, naming the module, the version and whether it came from Tavora or which publish token. If you didn't publish it, write to [tavora.app@gmail.com](mailto:tavora.app@gmail.com) right away.

The service checks the zip the way Tavora's installer does: the size and compression limits, the manifest and every file it names, that each screenshot really is a PNG or WebP within the limits, the changelog and the signature over every file. A zip that passes is checked automatically (see [Waiting for review](#waiting-for-review)) and, if all is well, listed at once. Read [what's not allowed in the catalog](./catalog-rules.md) before you publish.

## Waiting for review

Every new version goes through automatic checks: its words (including adult terms), what it asks for, whether it copies another module, warning signs in its code (`eval`, `new Function`, WebAssembly, code loaded from the internet, packed or obfuscated code) and a virus scan. If they all pass, it is listed at once. If one doesn't, or can't run, the version **waits**: it isn't listed, and a person at Tavora looks at it. A version also always waits when:

- it's the first module of your account, until one of your versions has been approved, or
- its icon or screenshots are new or changed since the last version.

Tavora's Publish screen says the version is waiting for review, and `tavora-pack publish` prints **Waiting for review** with the reasons. You get an email when it waits and another when it's decided; nothing is approved automatically. Waiting is normal and nothing to fix. **Approve** lists it, **Decline** tells you why in an email (*Unsafe or harmful*, *Hateful content*, *Adult content*, *Spam or copy* or *Doesn't work*, with an optional note), never lists that version and deletes its zip, and a developer who keeps breaking the [rules](./catalog-rules.md) can be banned: the account and its keys can't publish, and its modules leave the catalog.

To take a waiting version back, run `TAVORA_PUBLISH_TOKEN=tvp_… npx @tavora/pack withdraw <zip or sha256>`. An account can have 5 versions waiting at once.

## What users see

- **Browse** lists your module with its name, version, "by *your name*", its description, whether it works where the user is, how many times it was installed from Browse, and its rating: the average, stars and how many rated, with a New badge by its name below 3 ratings. Users can sort by name, rating or newest. Installs are counted per module only, with nothing about who installed it; updates don't count.
- **Your module's page** opens from its card: your icon, readme, screenshots and homepage, this version's patch notes, when it was updated and what it can reach. The description shows your readme as text: headings, paragraphs, lists, code, bold, italic and links to web pages (a click opens them in a Browser panel); pictures and HTML are never shown. Below it are this version's patch notes and a collapsed list of every version. The page also shows the network hosts and connectors it wants, so users see them before they install.
- **Ratings and reviews** are on your module's page: 1 to 5 stars from signed-in users, with an optional review of up to 500 characters. Every version's ratings count, and each review shows the version it was given on. You can't rate your own module, but you can post one reply under each review (Reply, signed in with the account that publishes the module). Reviews with slurs, links or email addresses wait until Tavora checks them; users can report a review, and Tavora can hide its text. Its stars still count. To keep ratings honest, an account can rate only once it is a day old and at most 10 modules a day, and a module's ratings beyond 20 new ones in a day wait for Tavora before they count.
- **Install** downloads the zip, checks it against the listing and your key's signature, and installs it like Install from zip. Installing grants nothing: users are asked for your network hosts and connectors when they add the module, as with any zip.
- Their data and permissions belong to your module id and your key, as [Your publisher key](./publisher-key.md#what-the-key-decides) explains.

## Updates

Build, then press **Publish** again. If you haven't raised `version` yet, the review screen offers the next one and a box for its patch notes. Each new version must be higher than the last one you published, and it's signed with the same key.

While online features are on, users' Tavora looks for updates a little after start, every few hours after that, and when they press **Check for updates** in Settings > Modules:

- Updates wait for the user. A button in the workspace header (for example "2 updates") opens the module library on **Updates**, with your patch notes for each new version and an **Update** button. Open panels reload when they update.
- Users who turn on **Update modules automatically** in Settings > Modules get an update that asks for nothing new at once, with a notice pointing to your patch notes.
- An update that asks for a network host or connector the installed version didn't ask for always waits for the user's yes, even with that setting on. The installed version keeps running until they allow it, and the patch notes show in the dialog.
- Every user gets the latest version. There's no way to pin an older one, and an older or equal version can't be published.

A zip a user installed by hand with Install from zip isn't updated from the catalog. Once they install your module from Browse, it is.

## Limits

An account can publish 10 versions a day and keep 200 MB of zips in the catalog. One upload is at most 50 MB. The review screen shows most problems before you press Publish. When the service refuses an upload, Tavora (or `tavora-pack publish`, from CI) says why:

| Message | What to do |
| --- | --- |
| Publishing needs your Tavora account | Publish from Tavora, or from CI with a key file and a publish token in `TAVORA_PUBLISH_TOKEN`. |
| This publisher key is linked to another Tavora account | Sign in to Tavora with the account the key is linked to, or use that account's publish token. |
| A publish token publishes only under id prefixes your account has | Publish the module's first version from Tavora, or claim the prefix there first. |
| Your publisher key is not linked to a Tavora account yet | Press **Link** next to it under Settings > Development > Publisher keys and CI. A key file: **Get a link code** under Publisher keys and CI, then `tavora-pack link <code> --key <file>`. |
| Another developer publishes under this id prefix | Give the module an id with a prefix of your own. |
| This id prefix is reserved | Pick another prefix; reserved words such as `tavora` and `local` are refused. |
| Your account already publishes under 3 id prefixes | Use one of the prefixes you have. |
| … already has 1.2.0; a new version must be newer | Raise `version` (the review screen does it for you). Also shown when another key published the module's first version. |
| Its version 1.2.0-beta.1 is a pre-release | Use a plain `major.minor.patch` version such as `1.2.0`. |
| Your account has published as many versions as it can today | Wait a day. |
| Your modules take as much room in the catalog as an account may have | Make the zip smaller. |
| The zip was refused: … | The zip failed a check; the message names it. |
| This account can't publish to the catalog any more | The account was banned. The email says why; see [what's not allowed](./catalog-rules.md). |
| Tavora declined this exact zip | Fix what the email says and publish a new version. |
| … versions are waiting for review already | Wait for them, or withdraw one with `tavora-pack withdraw`. |

## Publish from CI

A build server can publish too, with the `@tavora/pack` command line tool. It needs two secrets from **Settings > Development > Publisher keys and CI**:

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

Users can report a module from its page in Browse, or from Settings > Modules once it is installed. A report names only the module, your key and the zip, never the user, and hides nothing by itself: a person at Tavora looks at it. When your account has an email address, you get an email at most once a day saying your module was reported. Reports carry no sender, so there's nobody to answer.

If the module breaks the rules, Tavora can take it out of the catalog (users who installed it keep it), block a zip so it stops on every user's PC with their data kept, or revoke a key. A blocked module comes back only with a new version whose zip isn't blocked.

## A lost or leaked key

Tavora can hand your modules to a new key, but only if the old key was linked to your account. It signs a statement, offline with its own key, that the new key replaces the old one. Users' Tavora then takes updates signed by the new key for the old key's modules, and their data stays where it was.

Ask in the app: Settings > Development > Publisher keys and CI (press **Show**), then **Lost it?** next to the key.

- **I lost it:** your modules move to your newest key that Tavora keeps and that is linked to your account. If there is none, Tavora makes one and links it. Keys Tavora keeps are lost only with your recovery key.
- **It was leaked:** the same, and Tavora also revokes the old key. From the moment you ask, the catalog takes nothing new signed by it. Once revoked, it can't publish or install anything new. Modules users already have keep running, and so do the zips Tavora lists as published before the revocation.

Your account's email address gets a note that you asked. The key shows **Waiting for Tavora** until a person at Tavora has checked the request and signed it, then **Done**. Both keys stay linked while it waits. If something can't be done in the app, write to [tavora.app@gmail.com](mailto:tavora.app@gmail.com).

**A publish token leaked?** Remove it under Settings > Development > Publisher keys and CI. It stops working at once. A token alone can't publish; it needs your key too.

Once Tavora has signed the statement, publish new versions of your modules with the new key as usual. The catalog takes them because the statement names your account, and users' Tavora updates to them and keeps their data.

A key that was never linked can't be replaced. That's one more reason to [link yours now](./publisher-key.md#show-your-name).
