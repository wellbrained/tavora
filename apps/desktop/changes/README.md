# Change notes

A pull request that players will notice adds one Markdown file here and leaves the app version alone. When it merges, the Number workflow gives it the next version, writes its entry into `src/shared/patch-notes.ts`, raises both `package.json` files and removes the note. Two pull requests can't grab the same number this way.

Name the file after the change (`lost-key.md`). It holds a title and one line per thing players will notice, written like the patch notes in the app:

```md
# Lost a publisher key?

- Press Lost it? next to it in Settings > Account.
- Your modules move to your newest key once Tavora checks it.
```

That raises the patch number. A finished feature puts `bump: minor` on the first line, and its pull request needs the `feature-complete` label, which only the maintainer adds. Pull requests that only change docs, CI or tooling add no note.
