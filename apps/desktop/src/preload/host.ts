// Preload for the trusted host UI. Exposes a small, fixed API; the main
// process still checks that every call comes from the host window.
import { contextBridge, ipcRenderer } from "electron";
import type { AccountView, AiUsageView, DiscordView, HostShortcut, HostViewState, ModuleMenu, TavoraHostApi } from "../shared/host-api";

const api: TavoraHostApi = {
  getState: () => ipcRenderer.invoke("host:get-state"),
  act: (action) => ipcRenderer.invoke("host:action", action),
  searchCatalog: (query) => ipcRenderer.invoke("host:search-catalog", query),
  moduleNotes: (moduleId) => ipcRenderer.invoke("host:module-notes", moduleId),
  searchOnline: (query) => ipcRenderer.invoke("host:search-online", query),
  steamLibrary: (profile) => ipcRenderer.invoke("host:steam-library", profile),
  steamShareIcons: (appids) => ipcRenderer.invoke("host:steam-share-icons", appids),
  browseCatalog: () => ipcRenderer.invoke("host:browse-catalog"),
  catalogScreenshots: (moduleId) => ipcRenderer.invoke("host:catalog-screenshots", moduleId),
  setPanelBounds: (bounds) => ipcRenderer.send("host:panel-bounds", bounds),
  setOverlay: (open) => ipcRenderer.send("host:overlay", open),
  onState: (listener) => {
    ipcRenderer.on("host:state", (_event, state: HostViewState) => listener(state));
  },
  onFrozen: (listener) => {
    ipcRenderer.on("host:frozen", (_event, images: Record<string, string>) => listener(images));
  },
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
  onModuleMenu: (listener) => {
    ipcRenderer.on("host:module-menu", (_event, menu: ModuleMenu | null) => listener(menu));
  },
  answerModuleMenu: (requestId, id) => ipcRenderer.send("host:module-menu-answer", { requestId, id }),
};

contextBridge.exposeInMainWorld("tavoraHost", api);
