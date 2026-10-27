// The preload of the frame shown over a game overlay while the user arranges overlays (game-overlay-window.ts).
// It builds the handles and reports drags and the close button; the main process moves the window, reading the
// pointer itself, so nothing here decides where the overlay goes.
import { ipcRenderer } from "electron";

type Edge = "l" | "r" | "t" | "b" | "tl" | "tr" | "bl" | "br";
const EDGES: Edge[] = ["l", "r", "t", "b", "tl", "tr", "bl", "br"];

function build(name: string, closeLabel: string, layoutLabel: string) {
  const frame = document.getElementById("frame")!;
  frame.replaceChildren();
  const label = document.createElement("span");
  label.id = "name";
  label.textContent = name;
  const close = document.createElement("button");
  close.id = "close";
  close.textContent = "×";
  close.setAttribute("aria-label", closeLabel);
  close.addEventListener("pointerdown", (event) => event.stopPropagation());
  close.addEventListener("click", () => ipcRenderer.send("game-overlay:close"));
  frame.append(label, close);
  // A small button to the Overlay layout window; panels in game have none.
  if (layoutLabel) {
    const layout = document.createElement("button");
    layout.id = "layout";
    layout.textContent = "\u229E";
    layout.title = layoutLabel;
    layout.setAttribute("aria-label", layoutLabel);
    layout.addEventListener("pointerdown", (event) => event.stopPropagation());
    layout.addEventListener("click", () => ipcRenderer.send("game-overlay:layout"));
    frame.append(layout);
  }
  for (const edge of EDGES) {
    const handle = document.createElement("i");
    handle.className = "edge";
    handle.dataset.edge = edge;
    frame.append(handle);
  }
  let dragging = false;
  frame.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    frame.setPointerCapture(event.pointerId);
    const edge = (event.target as HTMLElement).dataset.edge;
    ipcRenderer.send("game-overlay:drag", "start", edge ?? null);
  });
  frame.addEventListener("pointermove", () => {
    if (dragging) ipcRenderer.send("game-overlay:drag", "move", null);
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    ipcRenderer.send("game-overlay:drag", "end", null);
  };
  frame.addEventListener("pointerup", end);
  frame.addEventListener("pointercancel", end);
}

ipcRenderer.on("game-overlay:frame", (_event, name: unknown, closeLabel: unknown, layoutLabel: unknown) => {
  if (typeof name === "string" && typeof closeLabel === "string" && typeof layoutLabel === "string") build(name, closeLabel, layoutLabel);
});
