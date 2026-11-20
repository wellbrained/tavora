// One module id can be loaded for another owner while its panels are open: a development folder (owner local) over an
// installed catalog copy, or back. A panel's grants are those of the owner its page runs as, never those of whichever
// copy is installed under its id now (host.ts: networkHostsOf, connectorsOf, folderHostOf; streaming.ts).

interface Owned {
  owner: string;
  manifest: { id: string };
}

/** The module installed now under `module`'s id, only while it is the same owner's; else undefined. */
export function sameOwner<T extends Owned>(module: Owned, installed: ReadonlyMap<string, T>): T | undefined {
  const found = installed.get(module.manifest.id);
  return found && found.owner === module.owner ? found : undefined;
}

/**
 * Open views whose module id is installed now for another owner (host.ts reloadModules): they stop, so no page runs as
 * one owner with another's grants. Views of a module that is gone are left to the cleanup of missing modules.
 */
export function viewsOfAnotherOwner<V extends { moduleId: string; owner: string }>(views: readonly V[], installed: ReadonlyMap<string, { owner: string }>): V[] {
  return views.filter((view) => {
    const found = installed.get(view.moduleId);
    return found !== undefined && found.owner !== view.owner;
  });
}
