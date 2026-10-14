# Tavora

Local-first, second-monitor gaming companion for Windows and Linux. Each game gets its own dockable workspace; community modules are self-contained web bundles that run inside a permission-checked host.

**Status:** Milestone A (runtime and isolation spike). Nothing here is a released or stable API yet.

## Layout

| Path | Purpose |
| --- | --- |
| `apps/desktop` | Tavora Desktop host shell (Electron, pending the Milestone A spike) |
| `packages/sdk` | `@tavora/sdk`, the thin typed client modules use to talk to the host |
| `packages/module-schema` | Manifest types and validation (`tavora.module.json`) |
| `examples/vanilla-module` | Test module with no framework |
| `examples/react-module` | Test module built with React |
| `docs/` | Threat model and architecture decisions |

Planned later, not created yet: `apps/{api,website,portal,docs}`, `packages/{cli,module-runtime,shared-types}`, `services/review-worker`, `infra/`.

## Getting started

```sh
corepack enable
pnpm install
pnpm typecheck
```

Requires Node 22+.
