# Your publisher key

Every zip you share is signed with your publisher key. To Tavora, the key is who you are: not your name, not your account.

## What the key decides

- **Updates.** A player's Tavora installs a newer zip of your module over the old one only if the same key signed it. A zip with your module's id but another key is refused: "comes from a different publisher".
- **Players' data.** Everything your module saves for a player belongs to your module's id and your key. An update with the same key keeps it; a module signed by any other key can never read it, even with the same id.
- **Permissions.** What players granted your module belongs to the same pair.

## Where it is

Tavora keeps your publisher key for you. In Tavora, sign in under **Settings > Account**, choose a **developer name** under Module developer and press **Make a key**. Tavora seals the key in your account's vault with your recovery key and links it to your account, so players see your name. If your account has no recovery key yet, Tavora shows you one now: keep it somewhere safe.

`tavora-pack` never sees the secret key. When you pack or publish, it asks Tavora on this PC to sign, and Tavora asks you first: it shows the module and its version, and signs only after you press **Allow**. Keep Tavora open while you pack.

- **On another PC**, sign in to Tavora, press **Get it from my other PC** under Settings > Account > Recovery key, and click **Add** on a PC that has your keys once both show the same code. Without another PC, type in your recovery key there. Your keys are there.
- **Several keys?** Pick one with `--publisher <fingerprint>`; the first few characters are enough.
- **A key from an older `tavora-pack`** in `~/.tavora/publisher-key.pem` still works: `tavora-pack` uses that file when it's there. Press **Add from a file** in Tavora to keep it there instead, then delete the file.

## Back it up

::: danger Without the key you can't update your module
Lose the key and your next zip counts as a different publisher. Players can't install it over the old one, and if they remove the old one first, your module starts with none of their data.
:::

Your recovery key is the backup: with it, any PC signed in to your account gets your publisher keys back. Without it, nobody can open the vault, not even Tavora. Keep it in a password manager or written down somewhere safe.

A lost or leaked key can be replaced by a new one only if it was linked to your account before it was lost: see [A lost or leaked key](./publishing.md#a-lost-or-leaked-key). Keys Tavora makes are linked at once.

## Publishing from CI

A build server can't click Allow. Press **Export** next to the key in Tavora to save it as a file, store it as a secret of your CI, and pass it with `--key <file>`. **Anyone with the file can publish as you**: never commit it, and export it only where you need it.

## Show your name

Players see who signed a module as the key's fingerprint, a long hex code. With your key linked to your Tavora account they see "by *your name*" instead: in Settings > Modules, in the permissions dialog, and when they install your zip.

Keys Tavora keeps are linked when you make or add them; if that failed, press **Link** next to the key. A developer name is public and unique (case, spaces, dots, dashes and underscores don't count), and you can change it once every 30 days.

To link a key file instead (one you sign with `--key`):

1. Press **Get a link code** under Module developer. Tavora shows a one-time code, valid for 10 minutes.
2. Copy the command it shows and run it in a terminal, in any folder:

   ```sh
   npx @tavora/pack link ABCD-EFGH --key <file>
   ```

The key signs the code, and only the signature and the key's public half are sent. An account can link several keys, and a key belongs to one account. You can unlink a key in Settings > Account.

The name is a label. What a player can install is still decided by the key's signature.

## Updates

1. Raise `version` in `tavora.module.json` (and in `package.json`, to keep them the same). Tavora refuses a zip with the same or a lower version than the installed one.
2. `npm run build`, then `npm run zip`, signed with the same key.
3. Send the new zip. Players install it with **Settings > Modules > Install zip**, over the old one, and keep their data.

If the new version uses something from a newer SDK, raise [`minTavora`](../reference/manifest.md) too, so an older Tavora says it needs an update instead of loading a module it can't run. The [SDK changelog](../reference/changelog.md) says which Tavora each feature needs.

Publish the new zip to the catalog too, and players who installed your module from it get the update on their own: see [Publishing to the catalog](./publishing.md#updates). There are no install links from web pages yet.
