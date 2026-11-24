# Old update checkers

The app-side update check (`src/main/update-signature.ts`) exactly as these versions shipped it, saved with `git show`,
unchanged: `update-compat.test.ts` runs a feed with the second signature line (`tavoraSignature2`) through them, to
prove apps already in the field still take it.

- `0.24.105/`: `git show v0.24.105:apps/desktop/src/main/update-signature.ts`, the first version that checks the signature.
- (0.25.0, the newest release tag when this was added, has the same file as 0.24.105.)
- `0.25.3/`: `git show 91bfe3e8:…` (the 0.25.3 version commit, not tagged yet), with its `shared/plain-version.ts`.

Never edit these files; add a folder for another version instead.
