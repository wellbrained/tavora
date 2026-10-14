# Decision log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-10-14 | pnpm monorepo, TypeScript, Node 22 | Matches the planned code layout; one repo while the team is small |
| 2026-10-14 | Spike Electron first, Tauri only if overhead fails | Same Chromium engine and per-view isolation on Windows and Linux |
| 2026-10-14 | One `WebContentsView` per panel, one session per module and game | Separate renderer processes and web storage per module; no cross-game leakage through browser storage |
| 2026-10-14 | Modules served from `tavora-module://<id>/` by a per-session protocol handler | Each module gets its own origin and can only read files inside its own package |
| 2026-10-14 | Bridge over a `MessagePort` the host binds to the view on creation | Identity is never part of a message, so it cannot be spoofed |
| 2026-10-14 | No module network access in Milestone A; `permissions.network` must be empty | Mediated, consented network access is designed separately; refusing is safer than ignoring |
| 2026-10-14 | Wire protocol v0 and manifest v0 are drafts | Expect breaking changes before Milestone B (superseded below) |
| 2026-10-14 | Equal columns instead of nested docking in the spike | Docking belongs to the player MVP; the spike only needs resize events |
| 2026-10-14 | Code is MIT licensed; the Tavora name and logo are not | Dominik wants the project to stay his without a payment model; MIT keeps contributions simple while the name stays protected |
| 2026-10-14 | Bridge protocol v1: `v` on every message plus a `bridge.handshake` before anything else | The host can refuse an SDK it cannot serve with a clear `INCOMPATIBLE` error instead of failing on some later call |
| 2026-10-14 | Gated methods (`network`, `files`, `clipboard`, `sharedData`) are reserved now and answer `PERMISSION_DENIED` | Modules can feature-detect safely, and the error shape will not change once grants exist |
| 2026-10-14 | Three data scopes: settings and documents per module and game, UI state per panel | Builds and plans must be shared across a module's panels; selection and scroll belong to one panel and should not outlive it |
| 2026-10-14 | Documents use revisions and optional `ifRevision`; other panels get `documents.changed` | Two panels of one module can edit the same plan without silently overwriting each other |
| 2026-10-14 | Manifest v1 rejects unknown fields; JSON Schema kept in agreement with the validator by tests | Typos fail loudly, and editors show exactly what Tavora will refuse |
| 2026-10-14 | `@tavora/sdk` ships built ESM plus types; workspace packages expose TypeScript sources under a `source` export condition | Examples build against the package as authors will, while host, tests and typecheck never depend on a stale build |
| 2026-10-14 | The host pings each panel's preload; no answer for 10 s marks it unresponsive | Chromium only detects hangs when input goes unanswered, which misses a panel nobody is clicking |
| 2026-10-14 | SDK not published to npm yet | Publishing needs the `@tavora` npm scope and a release process; decide before Milestone D |
| 2026-10-14 | Everything Tavora ships is Vue: host UI and official modules | Dominik works in Vue; React stays only as a community example module |
| 2026-10-14 | Host UI stack: Vue 3, Reka UI, shadcn-vue (sources kept in `src/renderer/components/ui`), Tailwind CSS with CSS custom properties; not Nuxt UI | Confirmed in kit doc 19: owned, editable components on accessible primitives, and tokens that theme packages can supply later |
| 2026-10-14 | Default theme only, dark, in Milestone C; theme packages, variations and personal overrides get their own milestone after Browser | One well-tested theme first; the token system keeps themes possible without a redesign. Details in [the style guide](design/style-guide.md) |
| 2026-10-14 | Token names follow shadcn-vue, plus `rail`, `success`, `warning`, `info` | shadcn-vue components and their updates work unchanged |
| 2026-10-14 | Games come from a built-in list of popular games or are added by name; icons are monograms or images the player picks | No online game database before the catalog server; Tavora ships no game art |
| 2026-10-14 | Removed games go to Trash for 30 days with all their data, then are deleted at startup, including module data and browser storage | Mistakes can be undone, and nothing of a deleted game lingers on disk |
| 2026-10-14 | Host UI actions go over one strictly parsed `host:action` channel | One place to validate everything the UI can ask for |
| 2026-10-14 | Module panels are hidden while a host menu or dialog is open | Native views draw above the host page and would cover them |
| 2026-10-14 | No news on Home for now; it shows recently played games | News sourcing and licensing are still open |
| 2026-10-14 | Core modules in Milestone C are Notes and To-Dos; Browser gets its own milestone, Boards come later | Browser needs its own security design |
| 2026-10-14 | Windows builds stay unsigned until the first public release, which is signed; SignPath Foundation (free for open source) is the first choice, a Certum open-source certificate the fallback | Unsigned is fine for a few testers; strangers need a publisher name, and the updater only verifies update signatures when the installed version was signed |
| 2026-10-14 | Public Windows builds use a per-user NSIS installer; the zip stays as a manual-update option, the portable exe only for test builds; Linux stays AppImage | A portable exe cannot update itself; NSIS needs no admin rights and supports differential updates |
| 2026-10-14 | App updates use `electron-updater`: download in the background, a marker on the rail, install on quit or "Restart now", never mid-session; an off switch for automatic download in Settings | Updates arrive without interrupting a game |
| 2026-10-14 | The update feed lives at `updates.mytavora.app` on Cloudflare R2, uploaded by the `v*` tag workflow as a draft and promoted by hand | The feed URL is compiled into every build, so it should not depend on where the repo lives; our own host allows pulling a release and staged rollouts |
| 2026-10-14 | Release channels: `stable` for everyone, `beta` (semver prereleases) as an opt-in in Settings; no downgrade when leaving beta | Testers get changes early without exposing everyone |
| 2026-10-14 | Core modules ship inside the app and update with it; community modules update from the catalog without an app restart, and new permissions need consent before an update applies | One version to test for what we ship; module updates stay independent of app releases. |
