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
    // Both backups of one start in one message: startNotice (cloud-copy-sync.ts) picks the text.
    expect(body(/static async create\(/)).toMatch(/const copyNotice = copySync\.notice;\s+if \(copyNotice\) host\.notice = translate\(host\.language, copyNotice\.key, copyNotice\.params\)/);
  });

  // That every look at the modules tells what follows them is ModulePanels' (module-panels.test.ts); this holds host.ts to ending OBS pages there.
  it("ends open OBS pages when grants change and whenever modules are looked for again", () => {
    expect(body(/grantsChanged: \(\) => \{/)).toContain("this.streaming?.recheckStreams()");
    expect(body(/modulesChanged: async \(restarted\) => \{/)).toContain("this.streaming?.recheckStreams()");
  });

  it("saves and pushes once per burst of panel.setContent, and writes a held-back save before flushing", () => {
    const setContent = body(/private setPanelContent\(/);
    expect(setContent).toContain("this.workspaces.saveSoon();");
    expect(setContent).toContain("this.pushStateSoon();");
    expect(setContent).not.toMatch(/this\.workspaces\.save\(\)|this\.pushState\(\)/);
    expect(body(/async saveAll\(\)/)).toContain("this.workspaces.flush();");
    expect(body(/async flush\(\): Promise<void> \{/)).toContain("this.workspaces.flush();");
  });

  // Restarting the panels of a module that changed owner is ModulePanels' (module-panels.test.ts).
  it("gives a panel only the grants of the owner its page runs as", () => {
    // The panel's connectors (its session gates them) are made for the module the page runs as.
    expect(body(/private createView\(/)).toContain("connectors: this.panelConnectors(record, module, workspace),");
    const connectors = body(/private panelConnectors\(/);
    expect(connectors).toContain("networkHosts: () => this.networkHostsOf(module),");
    expect(connectors).toContain("connectors: () => this.connectorsOf(module),");
    expect(connectors).toContain("folders: this.folderHostOf(module),");
    expect(body(/private networkHostsOf\(/)).toContain("sameOwner(module, this.modules)");
    expect(body(/private connectorsOf\(/)).toContain("sameOwner(module, this.modules)");
    expect(body(/private folderHostOf\(/)).toContain("sameOwner(module, this.modules)");
    // Settings' folder choice goes to the owner it showed, not to whichever copy holds the id now.
    expect(body(/"choose-module-folder": async \(action\) => \{/)).toContain("sameOwner({ owner: action.owner, manifest: { id: action.moduleId } }, this.modules)");
    // A connector question ends when its module's panels start again as another owner's, and Tavora's window shows it
    // only while the asking owner's copy is installed (panel-gate.ts ConnectorQuestions, pending-questions.ts).
    expect(body(/this\.modulePanels = new ModulePanels\(\{/)).toContain("ownerChanged: (moduleId) => this.connectorQuestions.ownerChanged(moduleId),");
    expect(host).toContain("new PendingQuestions({ installedOwner: (moduleId) => this.modules.get(moduleId)?.owner })");
    // The open module pages are the ones a look at the modules restarts or reloads.
    expect(body(/this\.modulePanels = new ModulePanels\(\{/)).toContain("views: () => this.moduleViews(),");
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

  it("resets the host page's popup watch when its overlay closes, so a late answer shows nothing (renderer/host.ts)", () => {
    // openWatch's reset is overlay-area.test.ts'; this holds the renderer's close to calling it.
    const renderer = readFileSync(path.join(import.meta.dirname, "../renderer/host.ts"), "utf8").replace(/\r\n/g, "\n");
    const close = /overlayRelease = setTimeout\(\(\) => \{([\s\S]*?)\n {4}\}, 0\);/.exec(renderer);
    expect(close?.[1]).toContain("watchState = openWatch(watchState);");
  });

  // The rule itself is OfficialPublishing's (official-publishing.test.ts); this holds host.ts to telling it what build this is.
  it("tells built-in module publishing whether this is a packaged build and whether the pins are set", () => {
    const made = body(/this\.officialPublishing = new OfficialPublishing\(\{/);
    expect(made).toContain("packaged: app.isPackaged,");
    expect(made).toContain("pinsOn: officialOn(OFFICIAL_PINS),");
  });
});
