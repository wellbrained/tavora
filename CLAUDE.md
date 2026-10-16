# Tavora

Decisions are logged in `docs/decisions.md`; the newest row on a topic wins.

## Versioning

The general rule (patch per change, minor only when Nik says) is in the global instructions. What is specific here:

- PRs that only change docs, CI or tooling keep the version.
- A minor raise needs the `feature-complete` label from Nik; the Version check fails without it.
- 1.0.0 is reserved for the first public release.
- Keep `apps/desktop/package.json` and the root `package.json` on the same version, and add a patch-notes entry (`apps/desktop/src/shared/patch-notes.ts`) for every bump. If another session shipped the same number first, take the next one.
