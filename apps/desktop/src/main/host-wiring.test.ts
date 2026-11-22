import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// host.ts can't be loaded in a unit test, so the pieces its safety rests on live in modules of their own, each with its
// own tests. This holds host.ts to calling them where it must: take a call away and the guarantee goes, so this fails.
const host = readFileSync(path.join(import.meta.dirname, "host.ts"), "utf8").replace(/\r\n/g, "\n");

/** The body of `name: (...) => { ... }` or `private [async] name(...) { ... }`, up to its closing brace at that indent. */
function body(start: RegExp): string {
  const match = start.exec(host);
  expect(match, String(start)).not.toBeNull();
  const indent = /^( *)/m.exec(host.slice(host.lastIndexOf("\n", match!.index) + 1))![1]!;
  const end = host.indexOf(`\n${indent}}`, match!.index);
  return host.slice(match!.index, end);
}

describe("host.ts", () => {
  it("tells the user where work done while a cloud copy waited is kept", () => {
    expect(body(/static async create\(/)).toMatch(/copySync\.changesKeptIn\) host\.notice = translate\(host\.language, "cloudCopy\.notice\.keptAside"/);
  });

  it("ends open OBS pages when grants change and whenever modules are looked for again", () => {
    expect(body(/grantsChanged: \(\) => \{/)).toContain("this.streaming?.recheckStreams()");
    expect(body(/private async reloadModulesNow\(\)/)).toContain("this.streaming?.recheckStreams()");
  });

  it("saves and pushes once per burst of panel.setContent, and writes a held-back save before flushing", () => {
    const setContent = body(/private setPanelContent\(/);
    expect(setContent).toContain("this.workspaces.saveSoon();");
    expect(setContent).toContain("this.pushStateSoon();");
    expect(setContent).not.toMatch(/this\.workspaces\.save\(\)|this\.pushState\(\)/);
    expect(body(/async saveAll\(\)/)).toContain("this.workspaces.flush();");
    expect(body(/async flush\(\): Promise<void> \{/)).toContain("this.workspaces.flush();");
  });

  it("gives a panel only the grants of the owner its page runs as, and restarts panels whose module changed owner", () => {
    const view = body(/private createView\(/);
    expect(view).toContain("networkHosts: () => this.networkHostsOf(module),");
    expect(view).toContain("connectors: () => this.connectorsOf(module),");
    expect(body(/private networkHostsOf\(/)).toContain("sameOwner(module, this.modules)");
    expect(body(/private connectorsOf\(/)).toContain("sameOwner(module, this.modules)");
    expect(body(/private folderHostOf\(/)).toContain("sameOwner(module, this.modules)");
    const reload = body(/private async reloadModulesNow\(\)/);
    expect(reload).toContain("viewsOfAnotherOwner(this.moduleViews(), modules)");
    // In place: closing for good would forget the panel's bounds, and the host UI sends none while they don't change.
    expect(reload).toContain("this.panels.restart(view.instanceId);");
    expect(reload).not.toContain("this.panels.close(view.instanceId);");
    expect(reload).toContain("if (restarted.size > 0) this.panels.applyBounds();");
    // What the old owner's page left is set aside before its page closes.
    expect(reload.indexOf("this.data.panelState.handOver(view.instanceId, view.owner,")).toBeLessThan(reload.indexOf("this.panels.restart(view.instanceId);"));
    expect(reload).toContain("delete record.content;");
    // Panels that waited for the old copy's question still start when the new copy asks nothing.
    expect(reload).toContain("for (const id of restarted) this.startWaitingPanels(id);");
    expect(body(/private reloadModuleViews\(/)).toContain("this.startWaitingPanels(moduleId);");
  });

  it("starts panels again after clearing their storage only when it wasn't cleared just before", () => {
    const purge = body(/private async purgeModuleStorage\(/);
    expect(purge).toContain("const restart = this.purges.note(key);");
    expect(purge).toContain("if (restart) for (const view of views) view.reload();");
    expect(purge).not.toMatch(/^\s*for \(const view of views\) view\.reload\(\);/m);
  });

  it("deletes a refused update's installer", () => {
    expect(host).toMatch(/onRefused: \(info\) => removeRefusedInstaller\(info, app\.isPackaged\)/);
  });

  // The rule itself is OfficialPublishing's (official-publishing.test.ts); this holds host.ts to telling it what build this is.
  it("tells built-in module publishing whether this is a packaged build and whether the pins are set", () => {
    const made = body(/this\.officialPublishing = new OfficialPublishing\(\{/);
    expect(made).toContain("packaged: app.isPackaged,");
    expect(made).toContain("pinsOn: officialOn(OFFICIAL_PINS),");
  });
});
