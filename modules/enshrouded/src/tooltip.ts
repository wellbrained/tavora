import {
  SkillNodes, getSelectableSkills, getSkillName, getSkillDescription,
  type SkillSelection,
} from "../vendor/core";
import {getNodeArt} from "./art";
import {escape} from "./tree";
import type {english} from "./copy";

// Keep the game's emphasis and line breaks, with no attributes, links or HTML
// capable of loading resources or executing code.
function gameMarkup(value: string): string {
  const document = new DOMParser().parseFromString(value, "text/html");
  const render = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escape(node.textContent ?? "");
    const content = [...node.childNodes].map(render).join("");
    if (!(node instanceof Element)) return content;
    if (node.tagName === "BR") return "<br>";
    if (["B", "STRONG"].includes(node.tagName)) return "<strong>" + content + "</strong>";
    if (["I", "EM"].includes(node.tagName)) return "<em>" + content + "</em>";
    return content;
  };
  return [...document.body.childNodes].map(render).join("");
}

export class SkillTooltip {
  private id: string | null = null;
  private at = {x:0, y:0};
  private selection: SkillSelection | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private element: HTMLElement,
    private current: () => SkillSelection,
    private copy: typeof english,
  ) {
    element.onpointerenter = () => clearTimeout(this.timer);
    element.onpointerleave = () => this.hide();
    element.onkeydown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.hide(true);
      }
    };
    window.addEventListener("blur", () => this.hide(true));
    window.addEventListener("resize", () => this.hide(true));
    document.addEventListener("visibilitychange", () => this.hide(true));
  }
  show(id: string, at: {x:number; y:number}) {
    clearTimeout(this.timer);
    const selection = this.current();
    const changed = this.id !== id || this.selection !== selection;
    this.id = id;
    this.at = at;
    if (changed) {
      this.selection = selection;
      this.render();
    }
    this.element.hidden = false;
    for (const node of document.querySelectorAll("[data-node][aria-describedby]")) node.removeAttribute("aria-describedby");
    document.querySelector('[data-node="' + id + '"]')?.setAttribute("aria-describedby", this.element.id);
    this.place();
  }
  refresh() {
    if (this.id && !this.element.hidden) this.show(this.id, this.at);
  }
  hide(immediate = false) {
    clearTimeout(this.timer);
    const close = () => {
      this.element.hidden = true;
      document.querySelector('[data-node="' + this.id + '"]')?.removeAttribute("aria-describedby");
    };
    // The short grace period lets the pointer cross the gap to read/scroll the card.
    if (immediate) close();
    else this.timer = setTimeout(close, 140);
  }
  private render() {
    const node = SkillNodes.nodes[this.id!];
    const meta = SkillNodes.types[node.type];
    const level = this.selection?.[node.id] ?? 0;
    const available = getSelectableSkills(this.selection ?? {}).includes(node.id);
    const state = level ? "selected" : available ? "selectable" : "locked";
    const art = getNodeArt(node, state);
    const size = node.tier === "large" ? 45 : node.tier === "medium" ? 25 : 20;
    const iconWidth = (size - (state === "locked" ? 20 : 15) - (art.iconOffset ?? 0)) / size * 100;
    const max = meta.maxLevel ?? 1;
    const label = level ? this.copy.unlocked : available ? this.copy.available : this.copy.outOfReach;
    this.element.className = "skill-tooltip " + state;
    this.element.dataset.tooltipNode = node.id;
    this.element.innerHTML =
      '<header class="skill-card-header"><span class="skill-card-art" aria-hidden="true"><img src="./skill-tree/' + escape(art.frame) + '">' +
      (art.icon ? '<img class="skill-card-icon" style="width:' + iconWidth + '%" src="./skill-tree/' + escape(art.icon) + '">' : "") +
      '</span><div><h2 id="skill-card-title">' + escape(getSkillName(node.type, "en")) + '</h2><p class="skill-card-state">' + (level ? "✓ " : "") + escape(label) + (max > 1 ? ' · ' + level + '/' + max : '') +
      '</p></div></header><div class="skill-card-body" tabindex="0" aria-labelledby="skill-card-title">' +
      getSkillDescription(node.type, "en", Math.max(1, level)).map(paragraph => "<p>" + gameMarkup(paragraph) + "</p>").join("") +
      '</div><footer><strong>' + escape(this.copy.skillPoints) + ':</strong> ' + meta.cost + (max > 1 ? ' / ' + escape(this.copy.rank.toLowerCase()) : '') + '</footer>';
  }
  private place() {
    const bounds = this.element.getBoundingClientRect();
    let x = this.at.x + 24;
    if (x + bounds.width > innerWidth - 8) x = this.at.x - bounds.width - 24;
    this.element.style.left = Math.max(8, Math.min(x, innerWidth-bounds.width-8)) + "px";
    this.element.style.top = Math.max(8, Math.min(this.at.y-24, innerHeight-bounds.height-8)) + "px";
  }
}
