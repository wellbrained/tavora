import { describe, expect, it } from "vitest";
import { serial } from "./documents";

describe("serial", () => {
  it("runs jobs one after another, even when one fails", async () => {
    const run = serial();
    const order: string[] = [];
    const slow = run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("slow");
      throw new Error("boom");
    });
    const fast = run(async () => void order.push("fast"));
    await expect(slow).rejects.toThrow("boom");
    await fast;
    expect(order).toEqual(["slow", "fast"]);
  });
});
