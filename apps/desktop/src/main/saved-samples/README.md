# Saved samples

The user's files as Tavora wrote them: every file at the version Tavora writes now, plus the older versions its moves and migrations still read. `saved-samples.test.ts` puts each where Tavora keeps it, opens it as Tavora does at start, and checks what it holds.

- **Every later version must still open these.** Never edit or delete a sample to make a test pass. A sample that stops opening means the change would lose a user's data.
- **Each new format adds its sample.** When a file's version goes up (`saved-versions.ts`), add `<file>.v<new>.json` as the new Tavora writes it. The test fails until every current version has one.

Names are `<file>.v<version>.json`. `v0` is a file from before it had a version (Tavora 0.24). `%USERDATA%` stands for the data folder; the test replaces it.

The current versions were written by Tavora's own store code. The older ones match what those versions wrote (the same shapes as in `workspace-move.test.ts` and `game-overlays.test.ts`). The sealed files (account, keys, Discord) have no sample: they only open on the PC and Windows user that sealed them.
