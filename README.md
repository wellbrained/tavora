# Tavora

Local-first, second-monitor gaming companion for Windows and Linux. Each game gets its own dockable workspace; community modules are self-contained web bundles that run inside a permission-checked host.

**Status:** Milestone C, the local player MVP, in progress. Done so far: the official Notes and To-Dos modules, the game library (built-in list and custom games, favorites, folders, Trash) on a collapsible game rail, plus everything from Milestone B (manifest v1, bridge protocol v1, `@tavora/sdk` 0.1.0, example modules in vanilla TypeScript, React and Vue). Nothing here is a released or stable API yet. See [docs/threat-model.md](docs/threat-model.md) for what the host guarantees and how it is tested.

## Layout

| Path | Purpose |
| --- | --- |
| `apps/desktop` | Tavora Desktop host (Electron): module views, bridge, storage, game library and the host UI (Vue, shadcn-vue, Tailwind) |
| `packages/sdk` | `@tavora/sdk`, the typed client modules use to talk to the host, plus the wire protocol types ([README](packages/sdk/README.md)) |
| `packages/module-schema` | `tavora.module.json` types, validation, JSON Schema, module and game id rules |
| `modules/notes`, `modules/todos` | Official Notes and To-Dos modules (Vue), built on `@tavora/sdk` like any other module ([README](modules/README.md)) |
| `modules/shared` | `@tavora/official-ui`: theme, shadcn-vue components and save helpers bundled into the official modules |
| `examples/vanilla-module` | Example module with no framework |
| `examples/react-module` | The same example built with React |
| `examples/vue-module` | The same example built with Vue |
| `apps/desktop/test/fixtures/hostile-module` | Deliberately hostile module used by the gate tests |
| `apps/docs` | Developer docs for [docs.mytavora.app](https://docs.mytavora.app/) (VitePress): guide, [manifest](apps/docs/reference/manifest.md), [bridge protocol](apps/docs/reference/protocol.md), and generated SDK API |
| `brand/logo` | Vector logo SVGs: master, lockup, emblem, wordmark and flame ([README](brand/logo/README.md)) |
| `docs/design/` | [Style guide](docs/design/style-guide.md): tokens, type, components, accessibility and theme rules |
| `docs/` | Threat model and decision log |

The marketing site at [mytavora.app](https://mytavora.app/) lives in its separate `tavora-website` repository.

Planned later, not created yet: `apps/{api,portal}`, `packages/{cli,module-runtime,shared-types}`, `services/review-worker`, `infra/`.

## Getting started

Requires Node 22+ and pnpm (via `corepack enable`).

```sh
pnpm install
pnpm build                              # SDK, host, official and example modules
pnpm --filter @tavora/desktop start     # opens Tavora with Notes, To-Dos and the example modules
pnpm --filter @tavora/docs dev          # developer docs at http://127.0.0.1:4001
```

To package a standalone test build after `pnpm build`:

```sh
pnpm --filter @tavora/desktop package --win    # portable exe and zip
pnpm --filter @tavora/desktop package --linux  # AppImage
```

Output lives in `apps/desktop/release/`. Builds include Notes, To-Dos and the example modules, keep data in the normal per-user folder, and are unsigned. Installers and automatic updates are planned separately.

### Development mode

```sh
pnpm dev
```

Opens Tavora without building it. Changes to the host UI (`apps/desktop/src/renderer`) show up instantly with hot reload, keeping the app's state. Changes to the main process or preloads (`src/main`, `src/preload`, `src/shared`) restart Tavora by itself after a second. Closing Tavora or pressing Ctrl+C ends it. The dev server uses port 4000; `pnpm dev --port <n>` picks another.

Modules run from their built files, so run `pnpm build` once first; after changing a module, rebuild it and reload its panel. Development mode only works from the source tree: packaged builds never load the dev server.

## Checks

Tests run locally. GitHub Actions only runs them for release tags (`v*`) or when started by hand. The docs site at docs.mytavora.app is served by Caddy on the Hetzner server; publish it with `pnpm --filter @tavora/docs deploy:server` once `apps/docs` has no uncommitted changes (builds on this PC, uploads the static files, keeps the previous release for rollback). The docs are their own project: the root `pnpm build`, `pnpm typecheck` and `pnpm check` skip `@tavora/docs`, and changes elsewhere in the repo never block a docs deploy.

```sh
pnpm check       # everything below, in order
pnpm typecheck
pnpm test        # unit tests (vitest)
pnpm test:e2e    # Electron gate tests (Playwright); on headless Linux wrap in xvfb-run -a
```

The e2e tests must run as a normal user, not root: Chromium refuses to start its sandbox as root, and the gate tests are only meaningful with the sandbox on.

## How a module runs

1. The host discovers packages with a `tavora.module.json` and validates the manifest. Modules shipped with Tavora (`modules/`) are shown as Official, everything else found on disk as Local; ids starting with `tavora.` are refused outside the official folder.
2. Each panel is a sandboxed `WebContentsView` with its own session per module and game, served from `tavora-module://<module-id>/` with a strict CSP. All network requests are cancelled.
3. The module's SDK posts a hello; the host creates a `MessagePort` bound to that view's module, game and panel, and relays it through a preload that exposes nothing else. The SDK then sends a versioned handshake.
4. Every request is validated by the host. Identity never comes from the message. Capabilities beyond the core (network, files, clipboard, shared data) are refused until grants exist.
5. The host watches each panel: a page that fails to load, stops answering its heartbeat or crashes is shown as such in the panel header, with Reload or Stop. Module data is kept.

## License

The code is available under the [MIT License](LICENSE). The Tavora name and logo are not covered by the license and may not be used to brand forks or derived apps.

Security issues: see [SECURITY.md](SECURITY.md).
