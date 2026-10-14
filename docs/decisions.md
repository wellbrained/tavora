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
