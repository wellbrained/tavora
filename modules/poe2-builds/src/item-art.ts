import type { Item } from './model';
import catalogue from './item-art.json';
import { resolveItemIdentity, itemCategory } from './item-identity.js';

const artwork: Readonly<Record<string,string>> = catalogue;
const key = (name: string) => name.trim().replace(/[’‘]/g,"'").toLowerCase();
const slots: Readonly<Record<string,string>> = {Weapon1:'icons/gear-weapon.svg',Weapon2:'icons/gear-weapon.svg',Offhand1:'icons/gear-offhand.svg',Offhand2:'icons/gear-offhand.svg',Helm1:'icons/gear-helmet.png',BodyArmour1:'icons/gear-body.svg',Gloves1:'icons/gear-gloves.svg',Boots1:'icons/gear-boots.svg',Amulet1:'icons/gear-amulet.svg',Belt1:'icons/gear-belt.svg',Ring1:'icons/gear-ring.png',Ring2:'icons/gear-ring.png',Charm1:'icons/gear-charm.svg',Charm2:'icons/gear-charm.svg',Charm3:'icons/gear-charm.svg'};
const weapons: Readonly<Record<string,string>> = {Bow:'gear-bow.png',Crossbow:'gear-crossbow.svg',Sceptre:'gear-sceptre.svg',Wand:'gear-wand.svg',Staff:'gear-staff.svg',Warstaff:'gear-staff.svg',Spear:'gear-spear.svg',Shield:'gear-shield.svg',Focus:'gear-focus.svg',Quiver:'gear-quiver.svg','One Hand Mace':'gear-mace.svg','Two Hand Mace':'gear-mace.svg','One Hand Sword':'gear-weapon.svg','Two Hand Sword':'gear-weapon.svg'};

/** Match bundled game artwork, never URLs supplied by an imported build.
 * Unique art must match the unique's name; rare crafted names use their base. */
export function itemArtwork(item: Item): string | undefined {
    item = resolveItemIdentity(item);
    const filename = item.rarity === 'unique' ? artwork[key(item.name)]
        : item.rarity === 'rare' || item.rarity === 'magic' ? artwork[key(item.base || item.name)]
        : artwork[key(item.name)] || artwork[key(item.base || '')];
    return typeof filename === 'string' ? `assets/items/${filename}` : undefined;
}
export function placeholderImage(inventoryId: string, position = 0, fallback = 'icons/gear-item.svg', category = ''): string {
    if (inventoryId === 'Flask2' || inventoryId === 'Flask1' && position === 1) return 'assets/icons/gear-mana-flask.png';
    if (inventoryId === 'Flask1') return 'assets/icons/gear-health-flask.png';
    return `assets/${weapons[category] && /^(Weapon|Offhand)/.test(inventoryId) ? 'icons/'+weapons[category] : slots[inventoryId] || fallback}`;
}
export function itemImage(item: Item, fallback = 'icons/gear-item.svg'): {src: string; actual: boolean} {
    const art = itemArtwork(item);
    return {src:art || placeholderImage(item.inventory_id,item.slot_x ?? 0,fallback,itemCategory(item)),actual:!!art};
}
