// Preload for the trusted host UI. Exposes a small, fixed API; the main
// process still checks that every call comes from the host window.
import { contextBridge, ipcRenderer } from "electron";
import type { HostViewState } from "../main/host";

const api = {
  getState: (): Promise<HostViewState> => ipcRenderer.invoke("host:get-state"),
  selectGame: (gameId: string): Promise<void> => ipcRenderer.invoke("host:select-game", gameId),
  openModule: (moduleId: string): Promise<void> => ipcRenderer.invoke("host:open-module", moduleId),
  closePanel: (instanceId: string): Promise<void> => ipcRenderer.invoke("host:close-panel", instanceId),
  reloadPanel: (instanceId: string): Promise<void> => ipcRenderer.invoke("host:reload-panel", instanceId),
  onState: (listener: (state: HostViewState) => void): void => {
    ipcRenderer.on("host:state", (_event, state: HostViewState) => listener(state));
  },
};

export type TavoraHostApi = typeof api;

contextBridge.exposeInMainWorld("tavoraHost", api);
