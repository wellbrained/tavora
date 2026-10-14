# Tavora

Local-first, second-monitor gaming companion for Windows and Linux. Each game gets its own dockable workspace; community modules are self-contained web bundles that run inside a permission-checked host.

**Status:** Milestone A, the module isolation spike. Nothing here is a released or stable API yet. See [docs/threat-model.md](docs/threat-model.md) for what the host guarantees and how it is tested.

## Layout

| Path | Purpose |
| --- | --- |
| `apps/desktop` | Tavora Desktop host (Electron): module views, bridge, storage, host UI |
| `packages/sdk` | `@tavora/sdk`, the typed client modules use to talk to the host, plus the wire protocol types |
| `packages/module-schema` | `tavora.module.json` types, validation, module and game id rules |
| `examples/vanilla-module` | Example module with no framework |
| `examples/react-module` | Example module built with React |
| `apps/desktop/test/fixtures/hostile-module` | Deliberately hostile module used by the gate tests |
| `docs/` | Threat model and decision log |

Planned later, not created yet: `apps/{api,website,portal,docs}`, `packages/{cli,module-runtime,shared-types}`, `services/review-worker`, `infra/`.

## Getting started

Requires Node 22+ and pnpm (via `corepack enable`).

```sh
pnpm install
pnpm build                              # host + example modules
pnpm --filter @tavora/desktop start     # opens Tavora with the example modules
```

## Checks

Tests run locally. GitHub Actions only runs them for release tags (`v*`) or when started by hand.

```sh
pnpm check       # everything below, in order
pnpm typecheck
pnpm test        # unit tests (vitest)
pnpm test:e2e    # Electron gate tests (Playwright); on headless Linux wrap in xvfb-run -a
```

The e2e tests must run as a normal user, not root: Chromium refuses to start its sandbox as root, and the gate tests are only meaningful with the sandbox on.

## How a module runs

1. The host discovers packages with a `tavora.module.json` and validates the manifest.
2. Each panel is a sandboxed `WebContentsView` with its own session per module and game, served from `tavora-module://<module-id>/` with a strict CSP. All network requests are cancelled.
3. The module's SDK posts a hello; the host creates a `MessagePort` bound to that view's module and game, and relays it through a preload that exposes nothing else.
4. Every request is validated by the host. Identity never comes from the message.
