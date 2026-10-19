import catalog from './gem-art.json';
import type { Gem } from './model';
type Position = number[];
const data = catalog as { active: Record<string, Position>; gems: Record<string, Position>; aliases: Record<string,string> };
const key = (s: string) => s.trim().toLowerCase().replaceAll('’', "'");
/** Exact local names and PoB identifiers only; build files cannot supply image URLs. */
export function gemArtwork(gem: Pick<Gem, 'name' | 'id' | 'isSupport'>): Position | null {
 const name = key(gem.name), alias = data.aliases[key(gem.id)];
 const find = (n: string) => (!gem.isSupport && data.active[n]) || data.gems[n];
 return find(name) || (alias && find(alias)) || null;
}
export function gemImage(gem: Gem): string {
 const attr = gem.attributes?.length === 1 ? gem.attributes[0]!.toLowerCase() : 'neutral';
 const art = gemArtwork(gem);
 return art ? `<span class="gem-mark gem-${attr} gem-art" aria-hidden="true" style="background-image:url('assets/gems/gems-${art[0]}.webp');--gem-x:${art[1]};--gem-y:${art[2]}"></span>` : `<span class="gem-mark gem-${attr}" aria-hidden="true">◆</span>`;
}
