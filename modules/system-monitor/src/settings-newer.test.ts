// A newer copy may add settings (the catalogue's, before a fallback to the shipped one): this version keeps them
// through a read, a change and the save, and still checks its own.
import { expect, it } from "vitest";
import { createMemoryHost } from "@tavora/sdk/testing";
import { createMonitor } from "./monitor";
import { APP_KEY, parseApp, parsePanel, toggleBlock } from "./settings";

it("keeps a newer version's app settings", () => {
  expect(JSON.parse(JSON.stringify(parseApp({ intervalMs: 7, units: "bits" })))).toMatchObject({ units: "bits" });
});

it("keeps a newer version's panel settings, sections and blocks", () => {
  const panel = toggleBlock(parsePanel({ sections: { system: true, network: false }, blocks: { cpu: "yes", fans: true }, compact: true }), "ram");
  expect(JSON.parse(JSON.stringify(panel))).toMatchObject({ compact: true, sections: { network: false }, blocks: { cpu: true, fans: true, ram: false } });
});

it("keeps a newer version's section and block when only that one is on", () => {
  const panel = parsePanel({ sections: { system: false, connection: false, network: true }, blocks: { cpu: false, gpu: false, ram: false, drives: false, fans: true } });
  expect(panel.sections).toMatchObject({ system: true, connection: true, network: true });
  expect(panel.blocks).toMatchObject({ cpu: true, fans: true });
});

it("saves only the setting that changed, so another workspace's choice and a newer version's value stay", async () => {
  const { sdk } = createMemoryHost({ capabilities: ["systemInfo"] });
  const monitor = createMonitor(sdk);
  await monitor.start();
  // Since this panel read the settings, a panel in another workspace picked its drives, and a newer version an interval this one doesn't have.
  await sdk.storage.app.set(APP_KEY, { intervalMs: 250, drives: ["D:"] });
  monitor.setInterval(5000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(await sdk.storage.app.get(APP_KEY)).toEqual({ intervalMs: 5000, drives: ["D:"] });
  // The panel shows what is stored now: the other workspace's drives too.
  expect(monitor.app.value).toMatchObject({ intervalMs: 5000, drives: ["D:"] });
  monitor.stop();
});

it("reads the app settings again when the panel is back, so another workspace's choice shows", async () => {
  const { sdk } = createMemoryHost({ capabilities: ["systemInfo"] });
  const monitor = createMonitor(sdk);
  await monitor.start();
  // Another panel changed them while this one was hidden.
  await sdk.storage.app.set(APP_KEY, { intervalMs: 5000, drives: ["D:"] });
  await monitor.reloadApp();
  expect(monitor.app.value).toMatchObject({ intervalMs: 5000, drives: ["D:"] });
  monitor.stop();
});
