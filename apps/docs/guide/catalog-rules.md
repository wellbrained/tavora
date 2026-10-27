# What's not allowed in the catalog

Tavora's [module catalog](./publishing.md) is open to everyone who makes modules, and it stays that way by keeping a few things out. If your module breaks one of these rules, a person at Tavora can decline a version, take a module out of the catalog or ban the developer account.

## Not allowed

- **Malware, or tricking users.** Modules that steal logins, tokens or files, hide what they do, load code from somewhere else to change what they do later, mine coins, or pretend to be another module or developer.
- **Hate and harassment.** Slurs, content that attacks people for who they are, threats, or modules made to bother a person or group.
- **Adult content (18+).** Pornography, sexual content and anything else meant only for adults. The catalog has no age check, so it is banned: in a module's name, descriptions, patch notes, readme, pictures or what it shows.
- **Cheats that break a game's rules.** Modules that give an unfair edge in online play, bypass anti-cheat, or read or change a game's memory or files. Helpers that work with what the game shows you, like timers, notes and trackers, are fine.
- **Copied modules.** Another developer's module, files or name under yours. Forks that say so, with permission or under a license that allows it, are fine.

Spam and modules that don't work at all can be declined too.

## What happens when you publish

Every new version goes through automatic checks. If they all pass, it is listed at once. If one doesn't, or can't run, the version waits and a person at Tavora looks at it. `tavora-pack publish` says **Waiting for review**, and you get an email now and when it's decided. Nothing is approved automatically.

A version waits when:

- **Your first module.** It always waits. Once one version of yours is approved, later versions skip this.
- **Words.** Its name, descriptions, patch notes or readme have words that aren't allowed, including adult terms.
- **Permissions.** A first version asks for network access or connectors, or an update asks for more than the last version did.
- **A copy.** It looks like another developer's module: a name that is nearly the same, or files that are mostly the same.
- **Code that needs a closer look.** `eval`, `new Function`, WebAssembly, code loaded from the internet or added to the page while it runs, or packed and obfuscated code. Build your module without these, and leave your code readable (a normal minified build is fine).
- **The virus scan.** It found something, or couldn't run.
- **New pictures.** The icon or screenshots are new or changed since the last version.

You don't need to do anything while a version waits. You can take it back with `tavora-pack withdraw <zip or sha256>` (it needs your publish token), then publish a fixed one.

## When a version is declined

You get an email with a reason: *Unsafe or harmful*, *Hateful content*, *Adult content*, *Spam or copy* or *Doesn't work*, and sometimes a note. That exact version is never listed, and its zip is deleted. Fix the problem and publish a new version.

## When a developer is banned

The account and all its publisher keys can't publish any more, and all its modules leave the catalog. Users who already installed them keep them. The email names the reason. If you think it's a mistake, write to [tavora.app@gmail.com](mailto:tavora.app@gmail.com).

## Reporting a module

Users can report a module from its page in Browse. A person at Tavora looks at every report and can take the module out of the catalog.
