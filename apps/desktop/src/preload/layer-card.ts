// Preload for the card at the top of the in-game layer (main/game-layer-card.ts): it shows what it is given, says how big
// the card is and whether the pointer is over it, and asks for a mode or Close. It has none of the host's calls, and the
// main process only listens to this page's own top frame.
import { contextBridge, ipcRenderer } from "electron";
import type { LayerCardState, TavoraLayerCardApi } from "../shared/layer-card";

const api: TavoraLayerCardApi = {
  ready: () => ipcRenderer.send("layer-card:ready"),
  onState: (listener) => {
    ipcRenderer.on("layer-card:state", (_event, state: LayerCardState) => listener(state));
  },
  extent: (size) => ipcRenderer.send("layer-card:extent", { width: size.width, height: size.height }),
  hover: (over) => ipcRenderer.send("layer-card:hover", over === true),
  setMode: (mode) => ipcRenderer.send("layer-card:mode", mode),
  close: () => ipcRenderer.send("layer-card:close"),
};

contextBridge.exposeInMainWorld("tavoraLayerCard", api);
