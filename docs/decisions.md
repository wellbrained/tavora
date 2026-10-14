# Decision log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-10-14 | pnpm monorepo, TypeScript, Node 22 | Matches the planned code layout; one repo while the team is small |
| 2026-10-14 | Spike Electron first, Tauri only if overhead fails | Same Chromium engine and per-view isolation on Windows and Linux |
| 2026-10-14 | One `WebContentsView` per panel, one session per module and game | Separate renderer processes and web storage per module; no cross-game leakage through browser storage |
| 2026-10-14 | Modules served from `tavora-module://<id>/` by a per-session protocol handler | Each module gets its own origin and can only read files inside its own package |
| 2026-10-14 | Bridge over a `MessagePort` the host binds to the view on creation | Identity is never part of a message, so it cannot be spoofed |
| 2026-10-14 | No module network access in Milestone A; `permissions.network` must be empty | Mediated, consented network access is designed separately; refusing is safer than ignoring |
| 2026-10-14 | Wire protocol v0 and manifest v0 are drafts | Expect breaking changes before Milestone B |
| 2026-10-14 | Equal columns instead of nested docking in the spike | Docking belongs to the player MVP; the spike only needs resize events |
