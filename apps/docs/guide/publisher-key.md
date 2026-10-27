# Your publisher key

Every version you publish, and every zip you share, is signed with your publisher key. To Tavora, the key is who you are: not your name, not your account.

## What the key decides

- **Updates.** A user's Tavora installs a newer zip of your module over the old one only if the same key signed it. A zip with your module's id but another key is refused: "comes from a different publisher".
- **Users' data.** Everything your module saves for a user belongs to your module's id and your key. An update with the same key keeps it; a module signed by any other key can never read it, even with the same id.
- **Permissions.** What users granted your module belongs to the same pair.

## Where it is

Tavora makes and keeps your publisher key for you. The setup under **Settings > Development** (the **Want to make modules?** card, or Publish before you've set up) signs you in and asks for a **developer name**; saving it makes your key. Tavora seals the key in your account's vault with your recovery key and links it to your account, so users see your name. If your account has no recovery key yet, Tavora shows you one now: keep it somewhere safe.

The key is used only inside Tavora, when you press Publish or Save as zip. Nothing outside Tavora can ask it to sign.

- **Linked a key file before?** The setup asks for it: press **Pick my key file…** (such as `~/.tavora/publisher-key.pem` from an older `tavora-pack`), since modules you already published update only with that key. Once Tavora keeps it, delete the file. Under **Publisher keys and CI** (press **Show**), **Add from a file** does the same later.
- **On another PC**, sign in to Tavora, press **Get it from my other PC** under Settings > Account > Recovery key, and click **Add** on a PC that has your keys once both show the same code. Without another PC, type in your recovery key there. Your keys are there.

## Back it up

::: danger Without the key you can't update your module
Lose the key and your next zip counts as a different publisher. Users can't install it over the old one, and if they remove the old one first, your module starts with none of their data.
:::

Your recovery key is the backup: with it, any PC signed in to your account gets your publisher keys back. Without it, nobody can open the vault, not even Tavora. Keep it in a password manager or written down somewhere safe.

A lost or leaked key can be replaced by a new one only if it was linked to your account before it was lost: see [A lost or leaked key](./publishing.md#a-lost-or-leaked-key). Keys Tavora makes are linked at once.

## Publishing from CI

A build server signs with your key as a file: press **Show** under **Settings > Development > Publisher keys and CI**, then **Export** next to the key, and pass the file to `@tavora/pack` with `--key <file>`. Publishing from CI also needs a publish token; [Publish from CI](./publishing.md#publish-from-ci) has the steps.

**With the file and a token, anyone can publish as you**: keep both as CI secrets, never commit them, and export the key only where you need it.

## Show your name

Users see who signed a module as the key's fingerprint, a long hex code. With your key linked to your Tavora account they see "by *your name*" instead: in Settings > Modules, in the permissions dialog, and when they install your zip.

Keys Tavora keeps are linked when you make or add them; if that failed, press **Link** next to the key. A developer name is public and unique (case, spaces, dots, dashes and underscores don't count), and you can change it once every 30 days.

To link a key file Tavora doesn't keep (one you sign with `--key` in CI):

1. Press **Get a link code** under Settings > Development > Publisher keys and CI. Tavora shows a one-time code, valid for 10 minutes.
2. Copy the command it shows and run it in a terminal, in any folder:

   ```sh
   npx @tavora/pack link ABCD-EFGH --key <file>
   ```

The key signs the code, and only the signature and the key's public half are sent. An account can link several keys, and a key belongs to one account. You can unlink a key in Settings > Development.

The name is a label. What a user can install is still decided by the key's signature.

## Updates

Build, then press **Publish** again: the review screen raises `version` (in `tavora.module.json`) and adds the patch notes if you haven't yet, and Tavora signs with the same key. Users who installed your module from the catalog get the update on their own: see [Publishing to the catalog](./publishing.md#updates).

If the new version uses something from a newer SDK, raise [`minTavora`](../reference/manifest.md) too, so an older Tavora says it needs an update instead of loading a module it can't run. The [SDK changelog](../reference/changelog.md) says which Tavora each feature needs.

A zip shared by hand updates the same way: press **Save as zip** and send it. Users install it with **Settings > Modules > Install zip**, over the old one, and keep their data. Tavora refuses a zip with the same or a lower version than the installed one. There are no install links from web pages yet.
