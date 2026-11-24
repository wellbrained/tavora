// The format version of every file that holds the user's data, in one place, so a newer Tavora's file is never written
// over by an older one. This module imports nothing: every store takes its version from here.
//
// Rules (the decision log, saved data, 2026-11-14):
// - Every file holding the user's data has a version and is kept with SavedFile (saved-file.ts), which keeps these
//   rules for its store: one a newer Tavora wrote is copied aside (`<file>.from-version-<n>`) before this one can write
//   over it; one that can't be read is set aside (`<file>.corrupt-<time>`) before starting fresh, and the user is told.
//   A new file gets its kind there (saved-file-rules.test.ts checks every one here has one, or says why not). Caches,
//   derived files and logs have neither (they are listed at the end).
// - These records keep the fields they don't know when they save (a kind's `keep`, or json.ts unknownFields), so a
//   new field on them needs no new version: library.json's top level, each workspace entry and each folder; workspace.json's top level, each
//   workspace, each panel and each snapshot; storage.json's top level (not inside `entries`); a panel-state file's top
//   level. Raise their version only for a change an older Tavora could misread. Everything nested in them is still
//   rebuilt from the fields this Tavora knows: a new field in a layout, a panel's `content`, a workspace's `icon`, the
//   library's `rail`, `theme`, `browser`, `profileRanks`, `dialogFolders`, `moduleFolders` or root items, or a new
//   workspace `kind`, raises the version like any other file.
// - An older Tavora writes its own version with the newer fields still in: a migration expects them there, as the
//   newer Tavora last wrote them (a snapshot's may describe a layout the older one replaced since), and a field name
//   once retired is never used again. A new setting that belongs to one PC goes inside the library's `pc`, never at its
//   top level: an older Tavora keeps an unknown top-level field another PC's cloud copy brought, but puts back this
//   PC's own `pc` as a whole (PC_SETTINGS).
// - Every other file: raise its version for any new field, and for any change an older Tavora could misread. Never
//   rename or restructure what is saved in one step: add to it, and read both forms.
// - saved-samples/ holds each file as Tavora wrote it, at every version still read; saved-samples.test.ts opens them
//   all. A new format adds its sample, and no later Tavora may stop opening one. saved-pins/ holds what each store
//   wrote byte for byte (saved-pins.test.ts): a change to it is a change of format.

/**
 * The files in the data folder itself, with the version this Tavora writes. SavedData.keepNewerFiles copies aside, at
 * start and before anything rewrites them, the ones a newer Tavora wrote; each store checks its file again when it reads it.
 */
export const SUPPORTED_VERSIONS = {
  "library.json": 2,
  "workspace.json": 3,
  "profile.json": 1,
  "grants.json": 1,
  "hotkeys.json": 2,
  "overlays.json": 2,
  "game-overlays.json": 5,
  "module-owners.json": 1,
  "official-updates.json": 1,
  "connection.json": 1,
  "traffic.json": 1,
  "ai-usage.json": 2,
  "module-data-pending.json": 1,
} as const;

/**
 * Files kept per module, panel or document, and the sealed ones (versioned as `v`): each store checks them when it reads
 * them, before it can write.
 */
export const STORE_VERSIONS = {
  /** module-data/<owner>/<module>/<workspace or _app>/storage.json */
  moduleSettings: 1,
  /** panel-state/<panel>.json */
  panelState: 1,
  /** module-data/…/documents/<id>.json (their index.json is rebuilt from them, so it is not checked). */
  document: 1,
  /** folder-access/<owner>/<module>/folders.json: the version sits next to the folders, which are never called "version". */
  chosenFolders: 1,
  /**
   * read-only-files/<owner>/<module>/<game>/sources.json: the version is on each entry, as Tavora 0.24 refuses a file
   * with anything but entries in it.
   */
  readOnlyFiles: 1,
  /** account.json, account-key.json (account-key.<account>.json, and the older cloud-copy-key.json), discord.json: sealed, `v`. */
  sealed: 1,
  /** The cloud copy's state: cloud-copy.json, and cloud-copy-swapping.json, where it is parked during a swap: `v`. */
  cloudCopy: 1,
  /** cloud-copy-place.json, where the cloud copy is kept: `v`. */
  copyPlace: 1,
  /** cloud-copy-status.json, where putting a cloud copy in place stands (cloud-copy-swap.ts): `v`. */
  copyStatus: 1,
  /** cloud-copy-staging/copy-list.json, the staged copy's list, and staged.json, where an older Tavora kept it: `v`. */
  copyList: 1,
  /** backups/cloud-copy-<time>-this-pc/incoming-lists.json, the lists of the copies a swap put in: `v`. */
  incomingLists: 1,
  /** cloud-copy-unused.json, how long this PC has seen each part in the copy's folder unused: `v`. */
  copyUnused: 1,
} as const;

// Not checked, as nothing of the user's is lost with them: window.json (where the window was), open-times.json (how
// fast layouts open here), games-seen.json (when games were seen running), update-feed.json (the newest time a signed
// update feed was seen at; a damaged one reads as none seen, newer fields are kept), inbox.json (which notes were shown),
// publisher-names.json and catalog-lists.json (downloaded), the documents' index.json (rebuilt), picker.json (a hint),
// a cloud copy swap's plan (swap-plan.json: written once as the swap begins, before its status, and made again from the
// backup when both are damaged) and the note of files lost at a held start (cloud-copy-lost.json: a damaged one reads as
// the library lost), pairing's steps (one pairing at a time), pairing-answers.json
// (when this PC last answered another PC without an Add), the vault cache (a copy of the account's) and
// account-vault-seen (a mark that the account's vault was seen), module-checks.json (the installed
// folders' signature checks, made again when missing), official-publisher-key.bin (development builds; the key file
// stays with its developer), and pictures and icons (not JSON).
