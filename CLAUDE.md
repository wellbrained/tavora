# Tavora

Decisions are logged in `docs/decisions.md`; the newest row on a topic wins.

## Versioning

- A PR that changes the app raises only the **patch** number (0.14.0 to 0.14.1). PRs that only change docs, CI or tooling keep the version.
- Never raise the **minor** or **major** number on your own. Only Nik says when a big feature is complete; that PR gets the `feature-complete` label from him, and the Version check fails a minor raise without it.
- 1.0.0 is reserved for the first public release.
- Keep `apps/desktop/package.json` and the root `package.json` on the same version, and add a patch-notes entry (`apps/desktop/src/shared/patch-notes.ts`) for every bump.
