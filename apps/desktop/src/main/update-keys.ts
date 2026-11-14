// The two public keys an app update must be signed with (update-signature.ts). Each is the raw Ed25519 public half,
// base64, printed by `pnpm tavora-update-key key <file>` (owner steps: deploy/README.md, "The update key").
//
//   release  the key `pnpm release` signs with (TAVORA_UPDATE_KEY)
//   backup   a second key whose private half is kept apart, offline, for when the release key is lost or leaks
//
// Both must be real keys before a release: `pnpm release` and the Release build check this file
// (`pnpm tavora-update-key check`) and refuse to ship while either is empty, since such an app could install no update.
// A key changed here counts only for apps built with it: an installed app keeps checking against the keys it shipped with.
export const PINNED_UPDATE_KEYS = {
  release: "",
  backup: "",
};
