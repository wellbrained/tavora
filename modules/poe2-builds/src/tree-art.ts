import catalog from './tree-art.json';
export interface TreeArtwork { file: string; className: string; x: number; y: number; width: number; height: number }
const versions = catalog as Record<string, Record<string, TreeArtwork>>;
/** Coordinates and artwork use the same native tree version as the nodes. */
export function treeArtwork(version: string, ascendancy: string, popover: boolean): TreeArtwork | null {
 const entries = versions[version];
 if (!entries) return null;
 const entry = entries[ascendancy];
 return entry ? (popover ? entry : entries[entry.className] || null) : null;
}
