# Change notes

A pull request that users will notice adds one Markdown file here and leaves the app version alone. When it merges, the Number workflow gives it the next version, writes its entry into `src/shared/patch-notes.ts`, raises both `package.json` files and removes the note. Two pull requests can't grab the same number this way.

Name the file after the change (`lost-key.md`). It holds a title and one line per thing users will notice, written like the patch notes in the app:

```md
# Lost a publisher key?

- Press Lost it? next to it in Settings > Account.
- Your modules move to your newest key once Tavora checks it.
```

For Tavora Admin, the Number workflow also records the pull request and tags the entry by the files it changed (`apps/desktop/scripts/change-tags.json` maps paths to tags). A note can add its own on a line before the title, `tags: cloud-copy, recovery-key` (lower-case words joined by hyphens); users never see them.

The 1.0.0 note is special: `bump: major`, a title like `Tavora 1.0` and two or three plain lines (they become the release's text in the update feed and on GitHub). In the app, that entry shows the 1.0 release catalog from `src/shared/release-catalog.ts` instead, and `pnpm release:fold` drops every earlier entry. Check that the catalog still matches the app before the release.

That raises the patch number. A finished feature puts `bump: minor` on the first line, and its pull request needs the `feature-complete` label, which only the maintainer adds. Pull requests that only change docs, CI or tooling add no note.
