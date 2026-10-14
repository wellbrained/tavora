# Module isolation threat model

**Status:** Milestone A draft (2026-10-14). Covers the local desktop host only; the catalog, publishing pipeline and update channel get their own model in Milestone E.

## What we protect

| Asset | Why it matters |
| --- | --- |
| The player's machine (files, processes, credentials, game memory) | A module must never become a way into the OS. |
| Each module's stored data, per game | Builds, notes and plans the player made with that module. |
| Other modules' data | One module must not read or corrupt another's data without an explicit grant (grants arrive in Milestone F). |
| The trusted context: which module is running, for which game | Everything else (storage, grants, permissions) is keyed on it. If a module can lie about it, every other check fails. |
| Network privacy | A module must not send player data anywhere without declared, consented, mediated access. |
| Host availability | A broken or hostile module must not take down Tavora or other panels. |

## Trust boundaries

```
 ┌──────────────── Tavora Desktop (Electron main process) ───────────────┐
 │  trusted: module registry, storage, layout, bridge, permission checks │
 └──────▲───────────────────────▲────────────────────────▲───────────────┘
        │ ipc (host preload)    │ MessagePort (bridge)   │ MessagePort (bridge)
 ┌──────┴───────┐        ┌──────┴────────────┐    ┌──────┴────────────┐
 │ Host UI      │        │ Module A view     │    │ Module B view     │
 │ trusted code │        │ UNTRUSTED code    │    │ UNTRUSTED code    │
 │ default sess.│        │ own session/origin│    │ own session/origin│
 └──────────────┘        └───────────────────┘    └───────────────────┘
```

- **Main process:** trusted. Only place with Node/OS access. Validates every bridge message.
- **Host UI renderer:** trusted code, still sandboxed with no Node. Talks to main only through a small preload API; main checks the sender is the host window.
- **Module renderers:** untrusted. Each module (per game) gets its own Electron session (`persist:module:<moduleId>@<gameId>`), its own origin (`tavora-module://<moduleId>/`), a separate renderer process from the host and from other modules, `sandbox: true`, `contextIsolation: true`, no Node, no `<webview>`.

## Attacker

A published or locally installed community module whose author is hostile, or whose dependencies were compromised. It controls all JavaScript, HTML and CSS in its own bundle and can send any bytes over its bridge port. It does not control the host, the main process, or other modules' bundles.

Out of scope for Milestone A: a malicious host build, local malware already running as the user, physical access, and the update/signing channel.

## Required guarantees (Milestone A gate)

| # | Guarantee | Mechanism | Test |
| --- | --- | --- | --- |
| G1 | No module can reach Node, Electron or OS APIs | sandbox, context isolation, no node integration, module preload exposes nothing | e2e: hostile module probes `require`, `process`, `ipcRenderer`, `electron` |
| G2 | No module can read or write another module's storage | host storage keyed by bound identity; separate sessions for web storage | unit + e2e: hostile module cannot see the other module's keys or localStorage |
| G3 | No module can choose or spoof its identity or game | identity bound in main to the sending webContents when the port is created; message params never carry identity | unit + e2e: forged `moduleId`/`gameId` fields are ignored |
| G4 | No network access unless the host mediates it | CSP, `webRequest` deny-all except own origin, unreachable proxy, WebRTC limited to proxied UDP | e2e: fetch, image, WebSocket, beacon and navigation to a local test server all fail, server sees zero hits |
| G5 | A crash does not take down the host or other modules | separate renderer processes, `render-process-gone` handling, reload | e2e: crash one module, the other keeps working, host shows a reload action |
| G6 | Modules can't escape their own bundle on disk | protocol handler resolves real paths inside the module root only | unit: `..`, encoded `..`, backslashes, null bytes, symlinks out of the root |
| G7 | Modules can't open windows, navigate away, download or request device permissions | `setWindowOpenHandler` deny, `will-navigate` same-origin only, downloads cancelled, permission handlers deny | e2e: `window.open`, cross-origin navigation |
| G8 | A module can't exhaust host resources through the bridge | message size cap, key/value validation, per-store quota | unit |

## Known limits and open risks

- **Webview isolation is not proven safe by this spike.** It relies on Chromium site isolation and the OS sandbox. A Chromium renderer exploit would break G1–G4. Mitigation: keep Electron current, enable the OS sandbox everywhere, set Electron fuses at packaging time (no `RunAsNode`, no `NODE_OPTIONS`, ASAR integrity, cookie encryption).
- **The OS sandbox is disabled when tests run as root in CI containers** (`--no-sandbox`). The JavaScript-level guarantees above are still exercised; OS-level sandbox coverage needs a non-root CI runner.
- **DNS prefetch and other browser side channels** may still leak hostnames even with requests blocked. Needs a packet-level check on Windows and Linux.
- **Timing and covert channels** between modules on the same machine are not addressed.
- **Same module, several panels** share a renderer process. A crash in one instance can take down its siblings of the same module, not other modules.
- **Data a module already received cannot be recalled** after a grant is revoked (relevant from Milestone F).
- **Tauri was not evaluated.** Electron was spiked first for a single Chromium engine on Windows and Linux. Revisit only if memory overhead is unacceptable.
