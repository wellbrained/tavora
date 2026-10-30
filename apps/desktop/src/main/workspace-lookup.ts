import { scopeForKind, type OverlayScope } from "./game-overlays";
import type { Library } from "./library";

/** What services that only name workspaces need to know of them. */
export interface WorkspaceNames {
  /** A workspace's name; null once it is gone. */
  name(workspaceId: string): string | null;
  /** Whether a workspace is a game workspace ("game") or a personal one ("all"); an unknown one counts as a game. */
  scopeOf(workspaceId: string): OverlayScope;
  /** The live game workspaces, by their ids and names (a game workspace's id is its game's). */
  games(): { id: string; name: string }[];
}

/** The library's workspaces as services see them; reads the library as it is now. */
export class LibraryWorkspaces implements WorkspaceNames {
  constructor(private readonly library: Pick<Library, "workspaces">) {}

  name(workspaceId: string): string | null {
    return this.library.workspaces[workspaceId]?.name ?? null;
  }

  scopeOf(workspaceId: string): OverlayScope {
    const entry = this.library.workspaces[workspaceId];
    return entry ? scopeForKind(entry.kind) : "game";
  }

  games(): { id: string; name: string }[] {
    return Object.values(this.library.workspaces)
      .filter((entry) => entry.kind === "game" && !entry.trashedAt)
      .map((entry) => ({ id: entry.id, name: entry.name }));
  }
}
