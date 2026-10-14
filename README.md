# Tavora

Local-first, second-monitor gaming companion for Windows and Linux. Each game gets its own dockable workspace; community modules are self-contained web bundles that run inside a permission-checked host.

**Status:** Milestone C, the local player MVP, in progress. Done so far: the game library (built-in list and custom games, favorites, folders, Trash) on a collapsible game rail, plus everything from Milestone B (manifest v1, bridge protocol v1, `@tavora/sdk` 0.1.0, example modules in vanilla TypeScript, React and Vue). Nothing here is a released or stable API yet. See [docs/threat-model.md](docs/threat-model.md) for what the host guarantees and how it is tested.

## Layout

| Path | Purpose |
| --- | --- |
| `apps/desktop` | Tavora Desktop host (Electron): module views, bridge, storage, game library and the host UI (Vue, shadcn-vue, Tailwind) |
| `packages/sdk` | `@tavora/sdk`, the typed client modules use to talk to the host, plus the wire protocol types ([README](packages/sdk/README.md)) |
| `packages/module-schema` | `tavora.module.json` types, validation, JSON Schema, module and game id rules |
| `examples/vanilla-module` | Example module with no framework |
| `examples/react-module` | The same example built with React |
| `examples/vue-module` | The same example built with Vue |
| `apps/desktop/test/fixtures/hostile-module` | Deliberately hostile module used by the gate tests |
| `docs/sdk/` | [Manifest](docs/sdk/manifest.md) and [bridge protocol](docs/sdk/protocol.md) reference |
| `docs/design/` | [Style guide](docs/design/style-guide.md): tokens, type, components, accessibility and theme rules |
| `docs/` | Threat model and decision log |

Planned later, not created yet: `apps/{api,website,portal,docs}`, `packages/{cli,module-runtime,shared-types}`, `services/review-worker`, `infra/`.

## Getting started

Requires Node 22+ and pnpm (via `corepack enable`).

```sh
pnpm install
pnpm build                              # SDK, host and example modules
pnpm --filter @tavora/desktop start     # opens Tavora with the example modules
```

### Developing

```sh
pnpm dev     # after one `pnpm build`: opens Tavora and rebuilds the host as you save
```

- **Host UI** (`apps/desktop/src/renderer`): saving a file rebuilds the UI and reloads the window in about a second. App state lives in the main process, so the open game and its panels stay as they are.
- **Main process and preloads** (`src/main`, `src/preload`, and the SDK and module-schema sources they import): saving rebuilds them and restarts Tavora.
- **Example modules** are not watched; rebuild them with `pnpm build` and use Reload on the panel.
- Closing the window stops `pnpm dev`.

Dev mode runs the same build as `pnpm build`: the UI is still served from `tavora-host://` with the same CSP and network block, so nothing tested here behaves differently in a packaged build. The price is a full window reload instead of hot module replacement, which would need the host renderer to load from a local dev server.

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
3. The module's SDK posts a hello; the host creates a `MessagePort` bound to that view's module, game and panel, and relays it through a preload that exposes nothing else. The SDK then sends a versioned handshake.
4. Every request is validated by the host. Identity never comes from the message. Capabilities beyond the core (network, files, clipboard, shared data) are refused until grants exist.
5. The host watches each panel: a page that fails to load, stops answering its heartbeat or crashes is shown as such in the panel header, with Reload or Stop. Module data is kept.

## License

The code is available under the [MIT License](LICENSE). The Tavora name and logo are not covered by the license and may not be used to brand forks or derived apps.

Security issues: see [SECURITY.md](SECURITY.md).
