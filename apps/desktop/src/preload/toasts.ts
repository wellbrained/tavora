// Preload for the toast page (main/toast-view.ts): it shows the toasts it is given and reports presses, nothing else.
// It has none of the host's calls; the main process also checks that every message comes from this page.
import { contextBridge, ipcRenderer } from "electron";
import type { TavoraToastsApi, ToastsPageState } from "../shared/host-toasts";

const api: TavoraToastsApi = {
  ready: () => ipcRenderer.send("toasts:ready"),
  onState: (listener) => {
    ipcRenderer.on("toasts:state", (_event, state: ToastsPageState) => listener(state));
  },
  extent: (size) => ipcRenderer.send("toasts:extent", { width: size.width, height: size.height }),
  action: (id) => ipcRenderer.send("toasts:action", id),
  dismiss: (id) => ipcRenderer.send("toasts:dismiss", id),
  release: () => ipcRenderer.send("toasts:release"),
};

contextBridge.exposeInMainWorld("tavoraToasts", api);
