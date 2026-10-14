// Preload for the trusted host UI. Exposes a small, fixed API; the main
// process still checks that every call comes from the host window.
import { contextBridge, ipcRenderer } from "electron";
import type { HostViewState, TavoraHostApi } from "../shared/host-api";

const api: TavoraHostApi = {
  getState: () => ipcRenderer.invoke("host:get-state"),
  act: (action) => ipcRenderer.invoke("host:action", action),
  searchCatalog: (query) => ipcRenderer.invoke("host:search-catalog", query),
  setWorkspaceRect: (rect) => ipcRenderer.send("host:workspace-rect", rect),
  setOverlay: (open) => ipcRenderer.send("host:overlay", open),
  onState: (listener) => {
    ipcRenderer.on("host:state", (_event, state: HostViewState) => listener(state));
  },
};

contextBridge.exposeInMainWorld("tavoraHost", api);
