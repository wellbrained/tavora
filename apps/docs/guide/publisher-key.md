# Your publisher key

Every zip you share is signed with your publisher key. To Tavora, the key is who you are: not your name, not your account.

## What the key decides

- **Updates.** A player's Tavora installs a newer zip of your module over the old one only if the same key signed it. A zip with your module's id but another key is refused: "comes from a different publisher".
- **Players' data.** Everything your module saves for a player belongs to your module's id and your key. An update with the same key keeps it; a module signed by any other key can never read it, even with the same id.
- **Permissions.** What players granted your module belongs to the same pair.

## Where it is

`tavora-pack` makes the key the first time you pack, in `~/.tavora/publisher-key.pem` (on Windows `C:\Users\<you>\.tavora\publisher-key.pem`). It never leaves your PC. Pass `--key <file>` to use a key somewhere else.

## Back it up

::: danger Without the key you can't update your module
Lose the key and your next zip counts as a different publisher. Players can't install it over the old one, and if they remove the old one first, your module starts with none of their data.
:::

- Copy `publisher-key.pem` somewhere safe that isn't this PC: a password manager, an encrypted USB stick.
- **Never share it** and never commit it. Whoever has it can publish updates as you. The key isn't in your project folder, and the starter's `.gitignore` keeps `*.pem` files out of git in case you put one there.
- On a new PC, copy the file back to `~/.tavora/publisher-key.pem` before you pack.

A lost or leaked key can be replaced by a new one only if it was [linked to your account](#show-your-name) before it was lost: see [A lost or leaked key](./publishing.md#a-lost-or-leaked-key). So link yours now.

## Show your name

Players see who signed a module as the key's fingerprint, a long hex code. Link your key to a Tavora account and they see "by *your name*" instead: in Settings > Modules, in the permissions dialog, and when they install your zip.

1. In Tavora, sign in under **Settings > Account** and choose a **developer name** under Module developer. It is public and unique (case, spaces, dots, dashes and underscores don't count), and you can change it once every 30 days.
2. Press **Link a publisher key**. Tavora shows a one-time code, valid for 10 minutes.
3. Copy the command it shows and run it in a terminal, in any folder:

   ```sh
   npx @tavora/pack link ABCD-EFGH
   ```

   In a module project, `npx tavora-pack link ABCD-EFGH` does the same. Pass `--key` if you sign with another key file.

The command signs the code with your key and sends the signature and the key's public half; the secret key stays on your PC. An account can link several keys, and a key belongs to one account. You can unlink a key in Settings > Account.

The name is a label. What a player can install is still decided by the key's signature.

## Updates

1. Raise `version` in `tavora.module.json` (and in `package.json`, to keep them the same). Tavora refuses a zip with the same or a lower version than the installed one.
2. `npm run build`, then `npm run zip`, with the same key.
3. Send the new zip. Players install it with **Settings > Modules > Install zip**, over the old one, and keep their data.

If the new version uses something from a newer SDK, raise [`minTavora`](../reference/manifest.md) too, so an older Tavora says it needs an update instead of loading a module it can't run. The [SDK changelog](../reference/changelog.md) says which Tavora each feature needs.

Publish the new zip to the catalog too, and players who installed your module from it get the update on their own: see [Publishing to the catalog](./publishing.md#updates). There are no install links from web pages yet.
