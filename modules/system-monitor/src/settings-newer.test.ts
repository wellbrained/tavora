// A newer copy may add settings (the catalogue's, before a fallback to the shipped one): this version keeps them
// through a read, a change and the save, and still checks its own.
import { expect, it } from "vitest";
import { parseApp, parsePanel, toggleBlock } from "./settings";

it("keeps a newer version's app settings", () => {
  expect(JSON.parse(JSON.stringify(parseApp({ intervalMs: 7, units: "bits" })))).toMatchObject({ units: "bits" });
});

it("keeps a newer version's panel settings, sections and blocks", () => {
  const panel = toggleBlock(parsePanel({ sections: { system: true, network: false }, blocks: { cpu: "yes", fans: true }, compact: true }), "ram");
  expect(JSON.parse(JSON.stringify(panel))).toMatchObject({ compact: true, sections: { network: false }, blocks: { cpu: true, fans: true, ram: false } });
});
