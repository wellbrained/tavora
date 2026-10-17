# Tavora

## Versioning

- Work in progress raises only the patch number. A minor raise needs the `feature-complete` label on the pull request; the Version check fails without it.
- PRs that only change docs, CI or tooling keep the version.
- 1.0.0 is reserved for the first public release.
- Keep `apps/desktop/package.json` and the root `package.json` on the same version, and add a patch-notes entry (`apps/desktop/src/shared/patch-notes.ts`) for every bump. If another pull request shipped the same number first, take the next one.

## Security

The public [security model](apps/docs/guide/security.md) lists what the host guarantees. A change that adds a way for a module or a web page to reach something outside its panel updates that page in the same pull request.
