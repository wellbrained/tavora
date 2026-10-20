import {
  SkillNodes,
  resolveNodePosition,
  resolveBaseAnchor,
  getSelectableSkills,
  getSkillName,
  TREE_LABELS,
  getTreeLabelName,
  type SkillSelection,
} from "../vendor/core";
import { getNodeArt } from "./art";
export const escape = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
// Frame diameters in the pinned upstream layout, in tree units.
const nodeSize = (tier?: string) => tier === "large" ? 45 : tier === "medium" ? 25 : 20;

export class Tree {
  private box = [-1150, -1150, 2300, 2300];
  private fitBox = [...this.box];
  private firstRender = true;
  private drag: { x: number; y: number; box: number[] } | null = null;
  private moved = false;
  private down: string | null = null;
  constructor(
    private svg: SVGSVGElement,
    private act: (id: string, refund: boolean) => void,
    private tooltip: {show(id: string, at: {x:number; y:number}): void; hide(immediate?: boolean): void},
  ) {
    svg.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.tooltip.hide(true);
        this.zoom(
          e.deltaY > 0 ? 1.15 : 1 / 1.15,
          (this.point(e.clientX, e.clientY).x - this.box[0]) / this.box[2],
          (this.point(e.clientX, e.clientY).y - this.box[1]) / this.box[3],
        );
      },
      { passive: false },
    );
    svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.down = this.node(e.target);
      this.moved = false;
      this.drag = { x: e.clientX, y: e.clientY, box: [...this.box] };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener("pointermove", (e) => {
      if (!this.drag) {
        const id = this.node(e.target);
        if (id) this.tooltip.show(id, {x:e.clientX, y:e.clientY});
        else this.tooltip.hide();
        return;
      }
      const dx = e.clientX - this.drag.x,
        dy = e.clientY - this.drag.y;
      if (Math.hypot(dx, dy) > 4) this.moved = true;
      if (this.moved) {
        this.tooltip.hide(true);
        const scale = Math.max(
          this.box[2] / svg.clientWidth,
          this.box[3] / svg.clientHeight,
        );
        this.box = [
          this.drag.box[0] - dx * scale,
          this.drag.box[1] - dy * scale,
          this.box[2],
          this.box[3],
        ];
        this.view();
      }
    });
    svg.addEventListener("pointerup", (e) => {
      this.drag = null;
      if (svg.hasPointerCapture(e.pointerId))
        svg.releasePointerCapture(e.pointerId);
      if (!this.moved && this.down) {
        this.act(this.down, false);
        this.tooltip.show(this.down, {x:e.clientX, y:e.clientY});
      }
      this.down = null;
    });
    svg.addEventListener("pointercancel", () => {
      this.drag = null;
      this.down = null;
    });
    svg.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const id = this.node(e.target);
      if (id) {
        this.act(id, true);
        this.tooltip.show(id, {x:e.clientX, y:e.clientY});
      }
    });
    svg.addEventListener("focusin", (e) => {
      const id = this.node(e.target);
      if (id) this.showTooltip(id);
    });
    svg.addEventListener("pointerleave", event => {
      if (!(event.relatedTarget instanceof Element && event.relatedTarget.closest('[role="tooltip"]'))) this.tooltip.hide();
    });
    svg.addEventListener("focusout", event => {
      if (!(event.relatedTarget instanceof Element && event.relatedTarget.closest('[role="tooltip"]'))) this.tooltip.hide();
    });
    svg.addEventListener("keydown", (e) => {
      const id = this.node(e.target);
      if (
        id &&
        (e.key === "Enter" ||
          e.key === " " ||
          e.key === "Delete" ||
          e.key === "Backspace")
      ) {
        e.preventDefault();
        this.act(id, e.key === "Delete" || e.key === "Backspace" || e.shiftKey);
      } else if (e.key === "Escape") {
        this.tooltip.hide(true);
      } else if (e.key.startsWith("Arrow")) {
        this.tooltip.hide(true);
        e.preventDefault();
        const step = this.box[2] * 0.08;
        this.box[0] +=
          e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        this.box[1] +=
          e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        this.view();
      }
    });
  }
  private showTooltip(id: string) {
    const node = this.svg.querySelector<SVGGElement>('[data-node="' + id + '"]');
    if (!node) return;
    const bounds = node.getBoundingClientRect();
    this.tooltip.show(id, {x:bounds.x+bounds.width/2, y:bounds.y+bounds.height/2});
  }
  private point(x: number, y: number) {
    const matrix = this.svg.getScreenCTM();
    return matrix
      ? new DOMPoint(x, y).matrixTransform(matrix.inverse())
      : { x: 0, y: 0 };
  }
  private node(target: EventTarget | null) {
    return target instanceof Element
      ? (target.closest("[data-node]")?.getAttribute("data-node") ?? null)
      : null;
  }
  private view() {
    this.svg.setAttribute("viewBox", this.box.join(" "));
  }
  fit() {
    this.tooltip.hide(true);
    this.box = [...this.fitBox];
    this.view();
  }
  zoom(factor: number, x = 0.5, y = 0.5) {
    this.tooltip.hide(true);
    const w = Math.max(280, Math.min(3400, this.box[2] * factor));
    const ratio = w / this.box[2];
    this.box = [
      this.box[0] + this.box[2] * x * (1 - ratio),
      this.box[1] + this.box[3] * y * (1 - ratio),
      w,
      this.box[3] * ratio,
    ];
    this.view();
  }
  focus(id: string) {
    const point = resolveNodePosition(SkillNodes.nodes[id]);
    this.box = [point.x - 320, point.y - 320, 640, 640];
    this.view();
    this.svg.querySelector<SVGGElement>('[data-node="' + id + '"]')?.focus();
    this.showTooltip(id);
  }
  private placeLabels() {
    const nodes = Object.values(SkillNodes.nodes).map(node => ({
      ...resolveNodePosition(node),
      radius: nodeSize(node.tier) / 2,
    }));
    // Place the entire text beyond the graph's supporting line in each class
    // direction. Links lie inside that boundary too, so neither nodes nor
    // branches can cross a label. Measure in SVG units, independent of zoom.
    const labels = [...this.svg.querySelectorAll<SVGTextElement>(".class-label")]
      .map((element, index) => ({element, label: TREE_LABELS[index], bounds: element.getBBox()}));
    let extent = 1100;
    for (const {element, label, bounds} of labels) {
      const angle = (label.angle + 90) * Math.PI / 180;
      const x = Math.cos(angle), y = Math.sin(angle);
      const outer = Math.max(...nodes.map(node => node.x*x + node.y*y + node.radius));
      const distance = outer + Math.abs(x)*bounds.width/2 + Math.abs(y)*bounds.height/2 + 32;
      const centerOffset = bounds.y + bounds.height/2 - Number(element.getAttribute("y"));
      element.setAttribute("x", String(x*distance));
      element.setAttribute("y", String(y*distance-centerOffset));
      extent = Math.max(extent, Math.abs(x*distance)+bounds.width/2+48, Math.abs(y*distance)+bounds.height/2+48);
    }
    this.fitBox = [-extent, -extent, extent*2, extent*2];
    if (this.firstRender) {
      this.box = [...this.fitBox];
      this.firstRender = false;
    }
  }
  render(selection: SkillSelection, query: string) {
    const focused = this.node(document.activeElement);
    const selectable = new Set(getSelectableSkills(selection));
    const q = query.trim().toLowerCase();
    const line = (
      a: { x: number; y: number },
      b: { x: number; y: number },
      active: boolean,
    ) =>
      '<line x1="' +
      a.x +
      '" y1="' +
      a.y +
      '" x2="' +
      b.x +
      '" y2="' +
      b.y +
      '" class="' +
      (active ? "active-link" : "") +
      '"/>';
    let links = "";
    for (const node of Object.values(SkillNodes.nodes)) {
      const a = resolveNodePosition(node);
      if (node.base)
        links += line(a, resolveBaseAnchor(node), !!selection[node.id]);
      for (const id of SkillNodes.edges[node.id])
        if (Number(id) > Number(node.id))
          links += line(
            a,
            resolveNodePosition(SkillNodes.nodes[id]),
            !!selection[node.id] && !!selection[id],
          );
    }
    const nodes = Object.values(SkillNodes.nodes)
      .map((node) => {
        const point = resolveNodePosition(node),
          level = selection[node.id] ?? 0,
          state = level
            ? "selected"
            : selectable.has(node.id)
              ? "selectable"
              : "locked",
          art = getNodeArt(node, state),
          size = nodeSize(node.tier);
        const name = getSkillName(node.type, "en");
        const match = !!q && name.toLowerCase().includes(q);
        const image = (path: string, s: number) =>
          '<image href="./skill-tree/' +
          escape(path) +
          '" x="' +
          -s / 2 +
          '" y="' +
          -s * 1.5 +
          '" width="' +
          s +
          '" height="' +
          s * 3 +
          '" preserveAspectRatio="xMidYMid meet"' +
          (art.dim ? ' style="filter:brightness(.5)"' : '') +
          '/>';
        return (
          '<g data-node="' +
          node.id +
          '" role="button" tabindex="0" aria-label="' +
          escape(name) +
          ", " +
          level +
          "/" +
          (SkillNodes.types[node.type].maxLevel ?? 1) +
          '" aria-pressed="' +
          !!level +
          '" class="node ' +
          state +
          (match ? " match" : "") +
          '" transform="translate(' +
          point.x +
          " " +
          point.y +
          ')"><circle r="' +
          size / 2 +
          '"/>' +
          image(art.frame, size) +
          (art.icon
            ? image(art.icon, size - (state === "locked" ? 20 : 15) - (art.iconOffset ?? 0))
            : "") +
          ((SkillNodes.types[node.type].maxLevel ?? 1) > 1
            ? '<text y="' +
              (size / 2) +
              '">' +
              level +
              "/" +
              (SkillNodes.types[node.type].maxLevel ?? 1) +
              "</text>"
            : "") +
          "</g>"
        );
      })
      .join("");
    const labels = TREE_LABELS.map((label) => {
      const r = ((label.angle + 90) * Math.PI) / 180;
      const distance = label.distance + 250;
      return (
        '<text class="class-label" x="' +
        Math.cos(r) * distance +
        '" y="' +
        Math.sin(r) * distance +
        '">' +
        escape(getTreeLabelName(label.nameKey, "en")) +
        "</text>"
      );
    }).join("");
    this.svg.innerHTML =
      '<g class="links">' +
      links +
      '</g><circle class="hub" r="198"/>' +
      labels +
      nodes;
    this.placeLabels();
    this.view();
    if (focused)
      this.svg
        .querySelector<SVGGElement>('[data-node="' + focused + '"]')
        ?.focus();
  }
}
