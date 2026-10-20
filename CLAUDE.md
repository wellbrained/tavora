# Tavora

## Versioning

- Don't raise the version in a pull request. Add a change note to `apps/desktop/changes/` instead (see its README); main gives out the next number and writes the patch-notes entry when the pull request merges.
- A note raises only the patch number. `bump: minor` is for a finished feature and needs the `feature-complete` label on the pull request; the Version check fails without it.
- PRs that only change docs, CI or tooling add no note.
- 1.0.0 is reserved for the first public release.

## Writing

Texts in the app are short and friendly, talking to the player as "you" (German: "du").

- Titles, labels and buttons are a few words. Descriptions are one short sentence, two at most.
- Keep only what the player needs to decide or act. Leave out how things work inside, unless it is about privacy or safety.
- Plain, casual words ("Can't find this folder", "Thanks!"), never stiff or technical ones.
- Write English and German together; both follow these rules.

## Security

The public [security model](apps/docs/guide/security.md) lists what the host guarantees. A change that adds a way for a module or a web page to reach something outside its panel updates that page in the same pull request.
