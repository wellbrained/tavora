import { describe, expect, it } from "vitest";
import type { PlanResult } from "../contracts/plan";
import { plan, solved, toRates } from "../solver/testing";
import { type FlowGraph, flowGraph, halfway, layoutFlow } from "./flowGraph";

const ORE = "Desc_OreIron_C";
const INGOT = "Desc_IronIngot_C";
const PLATE = "Desc_IronPlate_C";
const ROD = "Desc_IronRod_C";
const SCREW = "Desc_IronScrew_C";
const RIP = "Desc_IronPlateReinforced_C";
const PLASTIC = "Desc_Plastic_C";
const RUBBER = "Desc_Rubber_C";
const RESIDUE = "Desc_HeavyOilResidue_C";
const COKE = "Desc_PetroleumCoke_C";

const SIZES = { recipe: { width: 208, height: 112 }, end: { width: 200, height: 52 }, gap: 104 };

function graphOf(targets: Record<string, number>, patch: Parameters<typeof plan>[1] = {}): { graph: FlowGraph; result: PlanResult } {
  const thePlan = plan(targets, patch);
  const result = solved({ plan: thePlan });
  return { graph: flowGraph(result, thePlan.targets), result };
}

/** Each arrow as "from > to: item rate", boxes named by kind and item. */
function arrows(graph: FlowGraph): string[] {
  const name = (id: string) => {
    const node = graph.nodes.find((candidate) => candidate.id === id)!;
    return `${node.kind}:${node.item}`;
  };
  return graph.edges.map((edge) => `${name(edge.from)} > ${name(edge.to)}: ${edge.item} ${Math.round(edge.perMinute * 100) / 100}`).sort();
}

describe("flowGraph", () => {
  // 5 Reinforced Iron Plates: one ingot row feeds both plates (45) and rods (15).
  it("draws one box per row and splits a shared item into arrows", () => {
    const { graph } = graphOf({ [RIP]: 5 });
    expect(graph.nodes.map((node) => `${node.kind}:${node.item}`).sort()).toEqual(
      [`recipe:${RIP}`, `recipe:${PLATE}`, `recipe:${SCREW}`, `recipe:${ROD}`, `recipe:${INGOT}`, `raw:${ORE}`, `target:${RIP}`].sort(),
    );
    expect(arrows(graph)).toEqual(
      [
        `raw:${ORE} > recipe:${INGOT}: ${ORE} 60`,
        `recipe:${INGOT} > recipe:${PLATE}: ${INGOT} 45`,
        `recipe:${INGOT} > recipe:${ROD}: ${INGOT} 15`,
        `recipe:${ROD} > recipe:${SCREW}: ${ROD} 15`,
        `recipe:${PLATE} > recipe:${RIP}: ${PLATE} 30`,
        `recipe:${SCREW} > recipe:${RIP}: ${SCREW} 60`,
        `recipe:${RIP} > target:${RIP}: ${RIP} 5`,
      ].sort(),
    );
  });

  it("gives a row's box its whole row", () => {
    const { graph, result } = graphOf({ [RIP]: 5 });
    const ingot = graph.nodes.find((node) => node.item === INGOT && node.kind === "recipe")!;
    expect(ingot.row).toBe(result.rows.find((row) => row.item === INGOT));
    expect(ingot.perMinute).toBe(60);
  });

  // Plastic gives off 10 residue and rubber 20; coke uses 20, the other 10 leave.
  it("sends side products to their users and the rest out, in proportion", () => {
    const { graph } = graphOf({ [PLASTIC]: 20, [RUBBER]: 20, [COKE]: 60 });
    expect(arrows(graph).filter((arrow) => arrow.includes(`: ${RESIDUE}`))).toEqual(
      [
        `recipe:${PLASTIC} > recipe:${COKE}: ${RESIDUE} 6.67`,
        `recipe:${RUBBER} > recipe:${COKE}: ${RESIDUE} 13.33`,
        `recipe:${PLASTIC} > byproduct:${RESIDUE}: ${RESIDUE} 3.33`,
        `recipe:${RUBBER} > byproduct:${RESIDUE}: ${RESIDUE} 6.67`,
      ].sort(),
    );
  });

  it("balances every row: arrows in and out match its inputs and outputs", () => {
    const { graph, result } = graphOf({ [PLASTIC]: 20, [RUBBER]: 20, [COKE]: 60 });
    result.rows.forEach((row, index) => {
      const id = `row:${index}`;
      const sum = (item: string, side: "from" | "to") =>
        graph.edges.filter((edge) => edge[side] === id && edge.item === item).reduce((total, edge) => total + edge.perMinute, 0);
      for (const input of row.inputs) expect(sum(input.item, "to")).toBeCloseTo(input.perMinute, 6);
      for (const output of row.outputs) expect(sum(output.item, "from")).toBeCloseTo(output.perMinute, 6);
    });
  });

  it("shows supply next to what is made", () => {
    const { graph } = graphOf({ [PLATE]: 30 }, { fixedInputs: { [INGOT]: 15 } });
    expect(arrows(graph)).toContain(`supplied:${INGOT} > recipe:${PLATE}: ${INGOT} 15`);
    expect(arrows(graph)).toContain(`recipe:${INGOT} > recipe:${PLATE}: ${INGOT} 30`);
  });

  it("sends supply nobody needs straight out", () => {
    const { graph } = graphOf({ [PLATE]: 30 }, { fixedInputs: { [INGOT]: 60 } });
    expect(arrows(graph)).toEqual(
      [
        `supplied:${INGOT} > recipe:${PLATE}: ${INGOT} 45`,
        `supplied:${INGOT} > surplus:${INGOT}: ${INGOT} 15`,
        `recipe:${PLATE} > target:${PLATE}: ${PLATE} 30`,
      ].sort(),
    );
    expect(graph.nodes.find((node) => node.kind === "supplied")!.perMinute).toBe(60);
  });

  it("gives every target its own end box", () => {
    const { graph } = graphOf({ [PLATE]: 30, [ROD]: 15 });
    expect(graph.nodes.filter((node) => node.kind === "target").map((node) => node.item)).toEqual([PLATE, ROD]);
  });
});

describe("layoutFlow", () => {
  it("runs left to right, from the ore to the target", () => {
    const { graph } = graphOf({ [RIP]: 5 });
    const layout = layoutFlow(graph, SIZES);
    const x = (kind: string) => layout.nodes.find((placed) => placed.node.kind === kind)!.x;
    expect(x("raw")).toBeLessThan(x("recipe"));
    expect(Math.max(...layout.nodes.map((placed) => placed.x))).toBe(x("target"));
    expect(layout.edges.every((placed) => !placed.back && placed.points.length >= 2)).toBe(true);
    expect(layout.width).toBeGreaterThan(0);
  });

  it("marks the arrow that closes a loop", () => {
    const base = solved({ plan: plan({ [ORE]: 1 }) });
    const row = { building: "B", machines: 1, machinesRounded: 1, clockPercent: 100, powerMW: 0, alternatives: [] };
    const result: PlanResult = {
      ...base,
      rawResources: [],
      rows: [
        { ...row, recipe: "Recipe_A", item: "A", inputs: toRates({ B: 10 }), outputs: toRates({ A: 20 }) },
        { ...row, recipe: "Recipe_B", item: "B", inputs: toRates({ A: 10 }), outputs: toRates({ B: 10 }) },
      ],
    };
    const layout = layoutFlow(flowGraph(result, toRates({ A: 10 })), SIZES);
    expect(layout.edges.filter((placed) => placed.back)).toHaveLength(1);
  });
});

describe("halfway", () => {
  it("finds the middle of a bent line by its length", () => {
    expect(halfway([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }])).toEqual({ x: 20, y: 0 });
  });
});
