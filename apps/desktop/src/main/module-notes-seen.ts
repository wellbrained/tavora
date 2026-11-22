import type { Installed } from "./installed-modules";
import type { Library } from "./library";
import { hasUnseenNotes, installedNotes } from "./module-notes";
import type { InstalledModule } from "./registry";

export interface ModuleNotesSeenOptions {
  library: Pick<Library, "moduleNotesSeen">;
  saveLibrary: () => void;
  installed: Pick<Installed, "modules" | "get" | "info">;
}

/**
 * Which of the installed modules' patch notes the user has read, kept in the library under who publishes a module and
 * its id, so another publisher's module with the same id starts fresh. A module seen for the first time counts as read
 * up to its version, so only the notes of later updates are new. Tavora's built-in modules have none here.
 */
export class ModuleNotesSeen {
  constructor(private readonly options: ModuleNotesSeenOptions) {}

  /** Every installed module not seen before counts as read up to its version (at the start, and after modules are looked for). */
  noteNew(): void {
    const { library } = this.options;
    let changed = false;
    for (const module of this.options.installed.modules.values()) {
      const key = notesKey(module);
      if (module.builtIn || library.moduleNotesSeen[key] !== undefined) continue;
      library.moduleNotesSeen[key] = module.manifest.version;
      changed = true;
    }
    if (changed) this.options.saveLibrary();
  }

  /** The user read a module's notes, up to the version installed now. */
  seen(moduleId: string): void {
    const module = this.options.installed.get(moduleId);
    if (!module || module.builtIn) return;
    this.options.library.moduleNotesSeen[notesKey(module)] = module.manifest.version;
    this.options.saveLibrary();
  }

  /** What Settings shows of a module's patch notes: the newest version they cover, and whether any are new to the user. */
  view(module: InstalledModule): { latest: string | null; unseen: boolean } {
    const notes = installedNotes(this.options.installed.info.get(module.manifest.id)?.changelog ?? [], module.manifest.version);
    return { latest: notes[0]?.version ?? null, unseen: hasUnseenNotes(notes, module.manifest.version, this.options.library.moduleNotesSeen[notesKey(module)]) };
  }
}

/** The key a module's seen patch notes are kept under: who publishes it and its id. */
function notesKey(module: InstalledModule): string {
  return `${module.owner}:${module.manifest.id}`;
}
