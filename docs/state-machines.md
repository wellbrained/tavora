# State machines

A map of the flows in the app (`apps/desktop`) and the SDK (`packages/sdk`) that move through steps, so a developer or
an agent finds where a flow lives and what it can be in, without reading it all. The rules are in
[module-rules.md](module-rules.md#4-behaviour) ("One value per flow") and the State section of `CLAUDE.md`.

- **One value**: a flow keeps its state in one union (`status`, `phase`, `step`), never in flags that can disagree.
- **Work a view waits for**: `useTask` (`@tavora/official-ui/use-task`): `idle | running | failed`, always ends, drops an
  answer that is no longer the newest.
- **Dialogs in the slot** (renderer `host.ts`): after an `await`, a dialog closes itself with `closeDialog(request)` and
  goes on to the next one with `followDialog(from, next)`, so whatever the user opened meanwhile, or a question that came
  up, stays.
- **Real transitions** get a pure step function over the union, with tests (`dockDragStep` in `renderer/dock-drag.ts`).
- **Seen from outside**: the value goes on the view's root as `data-status` (`data-gesture` for a gesture), for tests and
  tools. `ModalDialog`'s `status` prop puts it on the dialog.

Update this page in the pull request that adds, removes or changes a flow.

## Renderer (host UI)

| Flow | File | States | Seen as |
| --- | --- | --- | --- |
| Dialog slot and its queue | `renderer/host.ts`, `renderer/dialog-queue.ts` | one request or none; host questions wait by rank (consent 4, new panel 3, link 2, game switch 1) | the dialog's `data-testid` |
| Dock drag | `renderer/dock-drag.ts` (`dockDragStep`) | `idle → lifted ⇄ aiming → idle` | |
| Work a dialog waits for | `ConfirmDialog`, `SteamImportDialog`, `PromptDialog`, `AddPersonalDialog`, `ShareIconsDialog`, `CatalogModuleDialog` (its links), `ProfileEditor`, the inbox dialogs, `LeaderboardQuestion`, the welcome's game and personal screens, `PanelContent` (install), `ConversationView` | `useTask`: `idle \| running \| failed` | `data-status` on the view's root, where it has one |
| Loads in catalog views | `CatalogBrowse`, `CatalogReviews`, `CatalogModuleDialog`, `CatalogIcon`, `ContactDeveloperDialog` | `useTask` (`latest`): a failure says so, with Try again (the icon shows the puzzle piece) | `data-status` on the view |
| Welcome | `pages/OnboardingPage.vue` | `steps \| signing-in \| finishing` (finishing runs once; back to `steps` when it fails) | `data-status` on `[data-testid=onboarding]` |
| Host questions (link, new panel, game switch) | `LinkChoiceDialog`, `NavigationChoiceDialog`, `GameSwitchDialog` | shown → answered once (Cancel is a button and the dialog closing) | |
| Update all's questions | `components/ModuleUpdates.vue`, `renderer/host.ts` (`updateQueue`, `askForUpdate`) | the updates that ask for more, one after another, only while the module library shows | |
| Recovery key after sign-in | `renderer/host.ts` (`askForRecoveryKey`) | not asked → waits for a free slot → asked (the publishing setup asks it itself) | `[data-testid=recovery-ask]` |
| Official publish run | `renderer/official-publish.ts` | phase from the main process (below) | |
| Panel tab | `components/workspace/PanelTab.vue` | the panel's `InstanceStatus` | `data-status` on the tab |
| Update marker, module rows | `UpdateMarker.vue`, `settings/ModuleRow.vue`, `developer/DevModuleRow.vue` | release and update status from the main process | `data-status` on the row |

## Main process

| Flow | File | States | Seen as |
| --- | --- | --- | --- |
| Module page | `main/module-view.ts` (`PagePhase`) | `loading → settling → revealed → drawn`, or `failed \| unresponsive \| crashed \| unavailable` | the panel's `InstanceStatus` in the view state |
| Module update install | `main/catalog-updates.ts` | one install per module at a time; a second press joins the install that is going | `installProgress` |
| App update | `main/updates.ts`, `shared/host-api.ts` (`UpdateState`) | `idle \| checking \| available \| downloading \| ready` | the view state's `update` |
| Official publish | `main/official-publish.ts` (`RunState`) | `idle \| building \| preview \| confirming \| uploading \| discarding` | `OfficialPublishView` |
| Module publish review | `main/module-publish.ts` | `checking \| ready \| publishing \| published`; a newer look drops an older one | `PublishView.status` |
| Sign-in | `main/account.ts` (`Pending`) | none, or `sign-in` (`code \| create`), `discord-create`, … | `AccountView.pending` |
| Pairing a new PC | `main/pairing.ts` (`Asking.step`) | `waiting → code → confirmed`, or `declined \| expired \| failed`; on the old PC, an answer that did not get through asks again | `PairingView.asking.step` |
| Discord connector | `main/discord.ts`, `shared/host-api.ts` (`DiscordStatus`) | `off \| signed-out \| connecting \| not-running \| approving \| connected \| error`; a generation drops old attempts | `DiscordView.status` |
| Media connector | `main/media.ts` | `starting \| ready \| failed \| unavailable` | the SDK's `MediaState.state` |
| Stream overlay server | `main/overlays.ts` (`OverlayServerStatus`) | `off \| running \| in-use \| failed`; starts and stops run in turn | Settings > Streaming |
| Cloud copy | `main/cloud-copy-sync.ts` (`CopySync`) | on or off, with the questions it waits on (`askKey`, `conflict`, `restartToTake`) and closing as `open → holding → released`; work started before it was turned off writes nothing (a turn raised by `forget`) | `CloudCopyView` |
| Developer keys | `main/developer-keys.ts` (`DeveloperKeys`) | `loading \| ready \| none \| ask \| signed-out \| offline`; the newest read wins | `DeveloperKeysView.status` |
| Connection tracker | `main/connection.ts` | online, or an outage of a kind (`ConnectionTracker.feed`) | Settings > Connections |
| Questions to the host UI | `main/pending-questions.ts` | asked → answered or cancelled, once | |

## SDK

| Flow | File | States | Seen as |
| --- | --- | --- | --- |
| Document store | `packages/sdk/src/store.ts` (`DocumentStatus`) | `idle \| dirty \| saving \| error` (stays as it is: modules read it) | `status` |
| Results | `packages/sdk/src/results.ts` (`ResultsState`) | `idle \| sending \| offline \| waiting \| denied \| unsupported \| failed` | `state` |
| Runs | `packages/sdk/src/runs.ts` | pure `finishRun`, `expireRun`, `makeRunCasual` | the saved run's `status` |
| Bootstrap | `packages/sdk/src/bootstrap.ts` (`BootstrapStatus`) | `connecting \| ready \| failed` | |

## Still implicit

Flows that still keep their state in several fields, most used first, with the plan for each. Take one off the list in
the pull request that makes it explicit.

- **In-game layer** (`main/game-overlay-service.ts`): `layer`, `escape`, `veil`, `front`, `away`, `suspended`, … →
  a `layerStep(state, look)` over `suspended | watching | game-in-front | open`, tested like `dockDragStep`.

- **Overlay window entries** (`main/game-overlay-service.ts` `Open`): `shown`, `arranging`, `idleSince` →
  `hidden | idle(since) | shown | arranging`; with the crash breaker (`crashes`, `stopped`) as `healthy | crashed | stopped`.

- **Host overlays over panels** (renderer `host.ts` `overlayOpen`, `panelsOut`, timers; main `panel-views.ts`
  `overlayOpen`, `overlayChanges`; `overlay-canvas.ts`) → one freeze flow `idle | capturing | frozen | thawing` with a
  step function, and `data-status` on `<html>`.

- **Workspace opening cover** (`main/host.ts` `openings`, `panel-views.ts` `openingState`, `panel-cover.ts`) → one
  opening with its own token: `waiting-for-data | covering | idle`.

- **Toast page health** (`main/toast-view.ts`: `ready`, `broken`, `fallback`, `retried`, `attempt`) →
  `loading | ready | retrying | down` with a step function.

- **Panel slot content** (`components/workspace/PanelContent.vue`: a 9-way `v-if`) → a pure `panelSlot(panel)` union
  and `data-status` on the slot.

- **Panel dialog** (`components/PanelDialog.vue`, `main/panel-views.ts` `dialogState`) → `closed | placing | drawn | shown`.

- **Browser panel** (`main/browser-view.ts`: `status`, `error`, `committedUrl`, `requestedUrl`) →
  `blank | loading | page | failed | crashed`.

- **Window visibility** (`main/host.ts`: `windowHidden`, `windowBehind`, `windowClosed`) → `front | behind | hidden | closed`.

- **Press windows** (`main/module-view.ts` `Press`, `browser-view.ts` `lastGesture`, tooltips) → one `GestureWindow`.

- **Gestures** (`WorkspaceRail` resize, `LayoutCanvas` drag and band, `WorkspacePage` panel drag) → one `gesture` union
  each, ended by blur too, with `data-gesture`.

- **System info worker** (`main/system-info-thread.ts`): one timer for two meanings → `none | running | idle-stopping |
  restart-waiting`.

- **Document store internals** (`packages/sdk/src/store.ts`: `pending`, `paused`, `skipDelete`) → an internal phase that
  `DocumentStatus` is read from; only with a model-based test first, and `DocumentStatus` stays.
