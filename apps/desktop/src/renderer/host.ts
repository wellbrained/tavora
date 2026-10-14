// Trusted host UI: game switcher, module buttons and panel headers. Module
// content itself is drawn by separate views the main process places below.
import type { HostViewState } from "../main/host";
import type { TavoraHostApi } from "../preload/host";

declare global {
  interface Window {
    tavoraHost: TavoraHostApi;
  }
}

const host = window.tavoraHost;
const gameSelect = document.querySelector<HTMLSelectElement>("#game")!;
const modulesEl = document.querySelector<HTMLDivElement>("#modules")!;
const headersEl = document.querySelector<HTMLDivElement>("#headers")!;
const noticeEl = document.querySelector<HTMLSpanElement>("#notice")!;
const emptyEl = document.querySelector<HTMLElement>("#empty")!;

const STATUS_LABEL: Record<HostViewState["panels"][number]["status"], string> = {
  loading: "Loading",
  ready: "",
  failed: "Could not load",
  unresponsive: "Not responding",
  crashed: "Stopped working",
};

function button(label: string, onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.addEventListener("click", onClick);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
}

function render(state: HostViewState): void {
  gameSelect.replaceChildren(
    ...state.games.map((game) => {
      const option = document.createElement("option");
      option.value = game.id;
      option.textContent = game.displayName;
      option.selected = game.id === state.currentGameId;
      return option;
    }),
  );

  modulesEl.replaceChildren(
    ...state.modules.map((module) => {
      const el = button(`+ ${module.name}`, () => void host.openModule(module.id), {
        "data-testid": `open-${module.id}`,
        title: module.available ? `Open ${module.name}` : `${module.name} does not support this game`,
      });
      el.disabled = !module.available;
      return el;
    }),
  );

  headersEl.replaceChildren(
    ...state.panels.map((panel) => {
      const header = document.createElement("div");
      header.className = "header";
      header.style.left = `${panel.x}px`;
      header.style.width = `${panel.width}px`;
      header.dataset.testid = `panel-${panel.instanceId}`;
      header.dataset.moduleId = panel.moduleId;
      header.dataset.status = panel.status;

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = panel.name;
      const status = document.createElement("span");
      status.className = `status ${panel.status}`;
      status.textContent = STATUS_LABEL[panel.status];
      header.append(name, status);

      if (panel.status === "crashed" || panel.status === "failed") {
        header.append(button("Reload", () => void host.reloadPanel(panel.instanceId), { "data-testid": "reload" }));
      }
      if (panel.status === "unresponsive") {
        header.append(button("Stop", () => void host.stopPanel(panel.instanceId), { "data-testid": "stop" }));
      }
      header.append(
        button("×", () => void host.closePanel(panel.instanceId), {
          "aria-label": `Close ${panel.name}`,
          "data-testid": "close",
        }),
      );
      return header;
    }),
  );

  noticeEl.textContent = state.notice ?? "";
  emptyEl.hidden = state.panels.length > 0;
}

gameSelect.addEventListener("change", () => void host.selectGame(gameSelect.value));
host.onState(render);
void host.getState().then((state) => state && render(state));
