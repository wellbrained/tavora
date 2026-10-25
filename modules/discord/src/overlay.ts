// The voice overlay page, shown over the game or in OBS. It runs outside Tavora, so it has no bridge and no network: it
// reads what the panel published for the "voice" overlay (watchOverlay) and draws it. Names come as text only
// (textContent), pictures as tiny data addresses.
import { watchOverlay } from "@tavora/sdk";
import { MAX_ROWS, type OverlayPerson, type OverlayState } from "./overlay-state";
import "./overlay.css";

const root = document.getElementById("overlay")!;
const COLOURS = ["#5865f2", "#3ba55d", "#faa61a", "#ed4245", "#eb459e", "#7289da"];
// Lucide's mic-off and headphone-off, fixed markup (nothing from the state goes into it).
const MIC_OFF = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19v3"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M16.95 16.95A7 7 0 0 1 5 12v-2"/><path d="M18.89 13.23A7 7 0 0 0 19 12v-2"/><path d="m2 2 20 20"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/></svg>';
const DEAF = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 14h-1.343"/><path d="M9.128 3.47A9 9 0 0 1 21 12v3.343"/><path d="m2 2 20 20"/><path d="M20.414 20.414A2 2 0 0 1 19 21h-1a2 2 0 0 1-2-2v-3"/><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 2.636-6.364"/></svg>';

/** Only a picture the panel made is drawn: a data address of an image, never anything else. */
const isPicture = (value: unknown): value is string => typeof value === "string" && /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value);

function row(person: OverlayPerson, names: boolean): HTMLElement {
  const element = document.createElement("div");
  element.className = "row";
  element.dataset.talking = String(person.s === 1);
  element.dataset.names = String(names);
  if (isPicture(person.a)) {
    const picture = document.createElement("img");
    picture.className = "avatar";
    picture.src = person.a;
    picture.alt = "";
    element.append(picture);
  } else {
    const circle = document.createElement("div");
    circle.className = "avatar";
    circle.style.setProperty("--colour", COLOURS[person.c] ?? COLOURS[0]!);
    const letters = document.createElement("span");
    letters.textContent = typeof person.i === "string" ? person.i.slice(0, 2) : "";
    circle.append(letters);
    element.append(circle);
  }
  if (names && typeof person.n === "string") {
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = person.n;
    element.append(name);
  }
  if (person.d === 1) element.insertAdjacentHTML("beforeend", DEAF);
  else if (person.m === 1) element.insertAdjacentHTML("beforeend", MIC_OFF);
  return element;
}

/** Reads the state as published; anything that doesn't look right draws nothing. */
function parse(raw: unknown): OverlayState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const state = raw as Partial<OverlayState>;
  if (state.v !== 1 || !Array.isArray(state.people)) return null;
  return { v: 1, names: state.names !== false, people: state.people.filter((person): person is OverlayPerson => typeof person === "object" && person !== null).slice(0, MAX_ROWS), more: typeof state.more === "number" && state.more > 0 ? Math.floor(state.more) : 0 };
}

let state: OverlayState | null = null;

function draw(): void {
  if (!state || state.people.length === 0) {
    root.replaceChildren();
    root.hidden = true;
    return;
  }
  root.hidden = false;
  const rows = state.people.length + (state.more > 0 ? 1 : 0);
  // One row is 40 px at most; with a small source the rows shrink to fit its height.
  root.style.fontSize = `${Math.max(12, Math.min(40, (innerHeight * 0.96) / rows / 1.15))}px`;
  const items = state.people.map((person) => row(person, state!.names));
  if (state.more > 0) {
    const more = document.createElement("div");
    more.className = "more";
    more.textContent = `+${state.more}`;
    items.push(more);
  }
  root.replaceChildren(...items);
}

watchOverlay((next) => {
  state = parse(next);
  draw();
});
addEventListener("resize", draw);
