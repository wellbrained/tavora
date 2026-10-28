// Preload for the trusted host UI. Exposes a small, fixed API; the main
// process still checks that every call comes from the host window.
import { contextBridge, ipcRenderer } from "electron";
import type { LayoutStills, LayoutView } from "../shared/layout-view";
import type { ContactDraft, ConversationDetailResult, InboxView } from "../shared/conversations";
import type { AccountView, AiUsageView, CloudCopyView, DeveloperKeysView, DiscordView, PairingView, PublishView, HostShortcut, HostViewState, ModuleMenu, TavoraHostApi } from "../shared/host-api";

const api: TavoraHostApi = {
  getState: () => ipcRenderer.invoke("host:get-state"),
  act: (action) => ipcRenderer.invoke("host:action", action),
  searchCatalog: (query) => ipcRenderer.invoke("host:search-catalog", query),
  popularGames: () => ipcRenderer.invoke("host:popular-games"),
  moduleNotes: (moduleId) => ipcRenderer.invoke("host:module-notes", moduleId),
  searchOnline: (query) => ipcRenderer.invoke("host:search-online", query),
  steamLibrary: (profile) => ipcRenderer.invoke("host:steam-library", profile),
  steamShareIcons: (appids) => ipcRenderer.invoke("host:steam-share-icons", appids),
  browseCatalog: () => ipcRenderer.invoke("host:browse-catalog"),
  catalogPage: (moduleId) => ipcRenderer.invoke("host:catalog-page", moduleId),
  modulePage: (moduleId) => ipcRenderer.invoke("host:module-page", moduleId),
  catalogIcon: (moduleId) => ipcRenderer.invoke("host:catalog-icon", moduleId),
  catalogReviews: (moduleId) => ipcRenderer.invoke("host:catalog-reviews", moduleId),
  releaseStatuses: (copies) => ipcRenderer.invoke("host:release-statuses", copies),
  setPanelBounds: (bounds) => ipcRenderer.send("host:panel-bounds", bounds),
  setWorkspaceBounds: (bounds) => ipcRenderer.send("host:workspace-bounds", bounds),
  setOverlay: (open) => ipcRenderer.send("host:overlay", open),
  layout: {
    getState: () => ipcRenderer.invoke("layout:get-state"),
    onState: (listener) => {
      ipcRenderer.on("layout:state", (_event, view: LayoutView) => listener(view));
    },
    send: (message) => ipcRenderer.send("layout:message", message),
    onStills: (listener) => {
      ipcRenderer.on("layout:stills", (_event, stills: LayoutStills) => listener(stills));
    },
    stillsShown: () => ipcRenderer.send("layout:stills-shown"),
  },
  setDimmed: (dimmed) => ipcRenderer.send("host:dimmed", dimmed),
  onState: (listener) => {
    ipcRenderer.on("host:state", (_event, state: HostViewState) => listener(state));
  },
  onFrozen: (listener) => {
    ipcRenderer.on("host:frozen", (_event, images: Record<string, string>) => listener(images));
  },
  frozenShown: () => ipcRenderer.send("host:frozen-shown"),
  onShortcut: (listener) => {
    ipcRenderer.on("host:shortcut", (_event, shortcut: HostShortcut) => listener(shortcut));
  },
  getDiscord: () => ipcRenderer.invoke("host:get-discord"),
  onDiscord: (listener) => {
    ipcRenderer.on("host:discord", (_event, view: DiscordView) => listener(view));
  },
  getAiUsage: () => ipcRenderer.invoke("host:get-ai-usage"),
  onAiUsage: (listener) => {
    ipcRenderer.on("host:ai-usage", (_event, view: AiUsageView) => listener(view));
  },
  getAccount: () => ipcRenderer.invoke("host:get-account"),
  onAccount: (listener) => {
    ipcRenderer.on("host:account", (_event, view: AccountView) => listener(view));
  },
  getCloudCopy: () => ipcRenderer.invoke("host:get-cloud-copy"),
  onCloudCopy: (listener) => {
    ipcRenderer.on("host:cloud-copy", (_event, view: CloudCopyView) => listener(view));
  },
  getDeveloperKeys: () => ipcRenderer.invoke("host:get-developer-keys"),
  onDeveloperKeys: (listener) => {
    ipcRenderer.on("host:developer-keys", (_event, view: DeveloperKeysView) => listener(view));
  },
  getPublish: () => ipcRenderer.invoke("host:get-publish"),
  onPublish: (listener) => {
    ipcRenderer.on("host:publish", (_event, view: PublishView | null) => listener(view));
  },
  getInbox: () => ipcRenderer.invoke("host:get-inbox"),
  onInbox: (listener) => {
    ipcRenderer.on("host:inbox", (_event, view: InboxView) => listener(view));
  },
  conversation: (id): Promise<ConversationDetailResult> => ipcRenderer.invoke("host:conversation", id),
  contactDraft: (moduleId): Promise<ContactDraft> => ipcRenderer.invoke("host:contact-draft", moduleId),
  getPairing: () => ipcRenderer.invoke("host:get-pairing"),
  onPairing: (listener) => {
    ipcRenderer.on("host:pairing", (_event, view: PairingView) => listener(view));
  },
  onModuleMenu: (listener) => {
    ipcRenderer.on("host:module-menu", (_event, menu: ModuleMenu | null) => listener(menu));
  },
  answerModuleMenu: (requestId, id) => ipcRenderer.send("host:module-menu-answer", { requestId, id }),
};

contextBridge.exposeInMainWorld("tavoraHost", api);
