import { describe, expect, it } from "vitest";
import type { Rate } from "../contracts/plan";
import { plan, solved, toRates } from "../solver/testing";
import { type ChainNode, MAX_NODES, productionChain } from "./chain";

const ORE = "Desc_OreIron_C";
const OIL = "Desc_LiquidOil_C";
const INGOT = "Desc_IronIngot_C";
const PLATE = "Desc_IronPlate_C";
const ROD = "Desc_IronRod_C";
const SCREW = "Desc_IronScrew_C";
const RIP = "Desc_IronPlateReinforced_C";
const PLASTIC = "Desc_Plastic_C";
const RUBBER = "Desc_Rubber_C";
const RESIDUE = "Desc_HeavyOilResidue_C";
const COKE = "Desc_PetroleumCoke_C";

/** The chain for a plan, solved on the sample data. */
function chainOf(targets: Record<string, number>, patch: Parameters<typeof plan>[1] = {}): ChainNode[] {
  const thePlan = plan(targets, patch);
  return productionChain(solved({ plan: thePlan }), thePlan.targets);
}

/** A node as a short readable shape: item, rate, machines, parts and children. */
type Shape = { item: string; perMinute: number; machines?: number; parts?: string[]; loop?: true; children?: Shape[] };
function shape(node: ChainNode): Shape {
  const out: Shape = { item: node.item, perMinute: node.perMinute };
  if (node.row) out.machines = node.machines;
  if (node.parts.length) out.parts = node.parts.map((part) => `${part.source}${part.from ? `:${part.from}` : ""} ${round(part.perMinute)}`);
  if (node.loop) out.loop = true;
  if (node.children.length) out.children = node.children.map(shape);
  return out;
}
const round = (value: number) => Math.round(value * 100) / 100;

describe("a plain chain", () => {
  // 5 Reinforced Iron Plates: 30 plates and 60 screws; the 60 ingots split 45 to plates, 15 to rods.
  it("splits a shared item by what each parent needs", () => {
    expect(chainOf({ [RIP]: 5 }).map(shape)).toEqual([
      {
        item: RIP,
        perMinute: 5,
        machines: 1,
        children: [
          {
            item: PLATE,
            perMinute: 30,
            machines: 1.5,
            children: [{ item: INGOT, perMinute: 45, machines: 1.5, children: [{ item: ORE, perMinute: 45, parts: ["raw 45"] }] }],
          },
          {
            item: SCREW,
            perMinute: 60,
            machines: 1.5,
            children: [
              {
                item: ROD,
                perMinute: 15,
                machines: 1,
                children: [{ item: INGOT, perMinute: 15, machines: 0.5, children: [{ item: ORE, perMinute: 15, parts: ["raw 15"] }] }],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("keys every node by its path", () => {
    const [root] = chainOf({ [RIP]: 5 });
    expect(root!.key).toBe("0");
    expect(root!.children.map((child) => child.key)).toEqual(["0.0", "0.1"]);
    expect(root!.children[1]!.children[0]!.children[0]!.key).toBe("0.1.0.0");
  });
});

describe("targets", () => {
  it("makes one root per target, in order", () => {
    expect(chainOf({ [ROD]: 15, [PLATE]: 20 }).map((node) => [node.item, node.perMinute])).toEqual([
      [ROD, 15],
      [PLATE, 20],
    ]);
  });

  it("shows a target that is also an ingredient both as a root and as a branch", () => {
    const [ingots, rods] = chainOf({ [INGOT]: 30, [ROD]: 15 });
    expect(shape(ingots!)).toEqual({ item: INGOT, perMinute: 30, machines: 1, children: [{ item: ORE, perMinute: 30, parts: ["raw 30"] }] });
    expect(rods!.children.map(shape)).toEqual([{ item: INGOT, perMinute: 15, machines: 0.5, children: [{ item: ORE, perMinute: 15, parts: ["raw 15"] }] }]);
  });

  it("ends at a raw target", () => {
    expect(chainOf({ [ORE]: 30 }).map(shape)).toEqual([{ item: ORE, perMinute: 30, parts: ["raw 30"] }]);
  });
});

describe("fixed inputs", () => {
  it("shows the supplied part next to what is made", () => {
    // 30 plates need 45 ingots: 15 supplied, 30 made by 1 smelter.
    const [plates] = chainOf({ [PLATE]: 30 }, { fixedInputs: { [INGOT]: 15 } });
    expect(shape(plates!.children[0]!)).toEqual({
      item: INGOT,
      perMinute: 45,
      machines: 1,
      parts: ["supplied 15"],
      children: [{ item: ORE, perMinute: 30, parts: ["raw 30"] }],
    });
  });

  it("ends at an item the supply covers", () => {
    const [plates] = chainOf({ [PLATE]: 30 }, { fixedInputs: { [INGOT]: 45 } });
    expect(shape(plates!.children[0]!)).toEqual({ item: INGOT, perMinute: 45, parts: ["supplied 45"] });
  });
});

describe("byproducts", () => {
  // 60 coke take 20 residue; plastic gives off 10 and rubber 20, 10 leave the factory.
  it("shows a used side product as coming from its rows, by share", () => {
    const [, , coke] = chainOf({ [PLASTIC]: 20, [RUBBER]: 20, [COKE]: 60 });
    expect(shape(coke!)).toEqual({
      item: COKE,
      perMinute: 60,
      machines: 0.5,
      children: [{ item: RESIDUE, perMinute: 20, parts: [`byproduct:${PLASTIC} 6.67`, `byproduct:${RUBBER} 13.33`] }],
    });
  });

  it("adds what is brought in next to the side products", () => {
    const [, , coke] = chainOf({ [PLASTIC]: 20, [RUBBER]: 20, [COKE]: 120 });
    expect(shape(coke!.children[0]!).parts).toEqual([`byproduct:${PLASTIC} 10`, `byproduct:${RUBBER} 20`, `import 10`]);
  });

  it("does not list side products under the row that gives them off", () => {
    const [plastic] = chainOf({ [PLASTIC]: 20 });
    expect(shape(plastic!)).toEqual({ item: PLASTIC, perMinute: 20, machines: 1, children: [{ item: OIL, perMinute: 30, parts: ["raw 30"] }] });
  });
});

describe("loops", () => {
  it("stops where an item repeats on its branch", () => {
    const rows = [
      { recipe: "Recipe_A", item: "A", building: "B", machines: 1, machinesRounded: 1, clockPercent: 100, powerMW: 0, alternatives: [] },
      { recipe: "Recipe_B", item: "B", building: "B", machines: 1, machinesRounded: 1, clockPercent: 100, powerMW: 0, alternatives: [] },
    ];
    const result = {
      ...solved({ plan: plan({ [ORE]: 1 }) }),
      rawResources: [],
      rows: [
        { ...rows[0]!, inputs: toRates({ B: 10 }), outputs: toRates({ A: 20 }) },
        { ...rows[1]!, inputs: toRates({ A: 10 }), outputs: toRates({ B: 10 }) },
      ],
    };
    const [a] = productionChain(result, toRates({ A: 10 }));
    expect(shape(a!)).toEqual({
      item: "A",
      perMinute: 10,
      machines: 0.5,
      children: [{ item: "B", perMinute: 5, machines: 0.5, children: [{ item: "A", perMinute: 5, loop: true }] }],
    });
  });
});

describe("size", () => {
  // 500 reinforced plate trees of 9 nodes each would be 4500.
  it(`stops adding inputs after ${MAX_NODES} nodes`, () => {
    const targets: Rate[] = Array.from({ length: 500 }, () => ({ item: RIP, perMinute: 5 }));
    const result = solved({ plan: plan({ [RIP]: 2500 }) });
    const chain = productionChain(result, targets);
    const count = (node: ChainNode): number => 1 + node.children.reduce((sum, child) => sum + count(child), 0);
    expect(chain.reduce((sum, node) => sum + count(node), 0)).toBeLessThan(MAX_NODES + targets.length);
    expect(chain.at(-1)).toMatchObject({ cut: true, children: [] });
  });
});
