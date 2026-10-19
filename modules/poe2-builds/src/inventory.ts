import {visibilitySwitch} from './controls';
import {itemDetails} from './item-details';
import type { Item } from './model';
import { esc } from './presentation';
import { resolveItemIdentity, weaponSlotState } from './item-identity.js';
import { itemImage, placeholderImage } from './item-art';

interface Slot { id: string; label: string; icon: string; x: number; y: number; w: number; h: number }
export const equipmentSlots: Slot[] = [
    {id:'weapon',label:'Main weapon',icon:'icons/gear-weapon.svg',x:42,y:27,w:76,h:150},
    {id:'offhand',label:'Offhand',icon:'icons/gear-offhand.svg',x:337,y:27,w:76,h:150},
    {id:'Helm1',label:'Helmet',icon:'helmet.png',x:185,y:16,w:76,h:76},
    {id:'BodyArmour1',label:'Body armour',icon:'body_armour.png',x:185,y:98,w:76,h:114},
    {id:'Amulet1',label:'Amulet',icon:'amulet.png',x:275,y:94,w:40,h:40},
    {id:'Ring1',label:'Left ring',icon:'ring.png',x:128,y:139,w:40,h:40},
    {id:'Ring2',label:'Right ring',icon:'ring.png',x:275,y:139,w:40,h:40},
    {id:'Gloves1',label:'Gloves',icon:'gloves.png',x:94,y:184,w:76,h:76},
    {id:'Boots1',label:'Boots',icon:'boots.png',x:275,y:184,w:76,h:76},
    {id:'Belt1',label:'Belt',icon:'belt.png',x:185,y:219,w:76,h:40},
    {id:'flask0',label:'Life flask',icon:'flask.svg',x:116,y:269,w:36,h:65},
    {id:'flask1',label:'Mana flask',icon:'flask.svg',x:294,y:269,w:36,h:65},
    {id:'charm0',label:'Charm 1',icon:'amulet.png',x:169,y:288,w:38,h:38},
    {id:'charm1',label:'Charm 2',icon:'amulet.png',x:207,y:288,w:38,h:38},
    {id:'charm2',label:'Charm 3',icon:'amulet.png',x:245,y:288,w:38,h:38},
];

/** Guide files use repeated Flask1/Charm1 records with slot_x; other exports
 * can use distinct numbered slot ids. Never fill a missing weapon swap from set 1. */
export function itemForSlot(items: Item[], id: string, weapon: 1 | 2): Item | undefined {
    if (id === 'weapon' || id === 'offhand') return items.find(i => i.inventory_id === (id === 'weapon' ? 'Weapon' : 'Offhand') + weapon);
    const match = /^(flask|charm)([0-2])$/.exec(id);
    if (match) {
        const position = Number(match[2]), prefix = match[1] === 'flask' ? 'Flask' : 'Charm';
        if (position > 0) { const explicit = items.find(i => i.inventory_id === prefix + (position + 1)); if (explicit) return explicit; }
        return items.find(i => i.inventory_id === prefix + '1' && (i.slot_x ?? 0) === position);
    }
    return items.find(i => i.inventory_id === id);
}

export function inventoryMarkup(shown: boolean, listShown = true): string {
    return `<div class="inventory-bar"><span>Equipment</span><div class="inventory-actions">${visibilitySwitch('toggle-inventory','Inventory',shown,'character-inventory')}${visibilitySwitch('toggle-equipment-list','Equipment list',listShown,'equipment-list')}</div></div><div id="character-inventory" class="character-inventory" ${shown ? '' : 'hidden'}><div class="inventory-title">Inventory</div><div class="equipment" aria-label="Character equipment slots"></div></div>`;
}
function rarity(i?: Item) { return i?.rarity && ['normal','magic','rare','unique'].includes(i.rarity) ? i.rarity : 'unknown'; }

interface Options { shown: boolean; listShown: boolean; weapon: 1 | 2; notesFor?: (item: Item) => string | undefined; onChange: (change: {inventory?: boolean; equipmentList?: boolean; gearWeapon?: 1 | 2}) => void }
export class Inventory {
    private tooltip = document.createElement('aside');
    private pinned: HTMLButtonElement | null = null;
    private anchor: HTMLButtonElement | null = null;
    private equipment: HTMLElement;
    private outside = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest('.equip-slot,.inventory-tooltip')) this.dismiss(); };
    private escape = (event: KeyboardEvent) => { if (event.key === 'Escape') this.dismiss(); };
    private moved = () => this.dismiss();
    constructor(private root: HTMLElement, private items: Item[], private options: Options) {
        this.equipment = root.querySelector('.equipment')!;
        this.tooltip.className = 'inventory-tooltip'; this.tooltip.id = 'equipment-tooltip'; this.tooltip.hidden = true;
        this.tooltip.setAttribute('role','tooltip'); document.body.append(this.tooltip);
        root.querySelector<HTMLInputElement>('#toggle-inventory')!.onchange = () => {
            this.dismiss(); options.shown = !options.shown;
            root.querySelector<HTMLElement>('#character-inventory')!.hidden = !options.shown;
            const button = root.querySelector<HTMLInputElement>('#toggle-inventory')!;
            button.checked = options.shown;
             options.onChange({inventory:options.shown});
        };
        root.querySelector<HTMLInputElement>('#toggle-equipment-list')!.onchange = () => {
            options.listShown=!options.listShown;
            root.querySelector<HTMLElement>('#equipment-list')!.hidden=!options.listShown;
            const button=root.querySelector<HTMLInputElement>('#toggle-equipment-list')!;
            button.checked=options.listShown;
            options.onChange({equipmentList:options.listShown});
        };
        document.addEventListener('pointerdown',this.outside);
        document.addEventListener('keydown',this.escape);
        root.addEventListener('scroll',this.moved,true); window.addEventListener('resize',this.moved);
        this.draw();
    }
    private draw() {
        this.dismiss();
        const weapons = weaponSlotState(this.items,this.options.weapon);
        this.equipment.innerHTML = ['left','right'].map(side => `<div class="inventory-set ${side}">${[1,2].map(set => `<button data-gear-weapon="${set}" aria-label="Weapon set ${set}" aria-pressed="${this.options.weapon === set}" class="${this.options.weapon === set ? 'active' : ''}">${set === 1 ? 'I' : 'II'}</button>`).join('')}</div>`).join('') + equipmentSlots.map(slot => {
            const item = itemForSlot(this.items,slot.id,this.options.weapon);
            const label = slot.id === 'weapon' ? weapons.mainLabel : slot.id === 'offhand' ? weapons.offhandLabel : slot.label;
            const blocked = slot.id === 'offhand' && weapons.blocked;
            const emptyId = slot.id === 'weapon' ? 'Weapon' + this.options.weapon : slot.id === 'offhand' ? 'Offhand' + this.options.weapon : slot.id.startsWith('flask') ? 'Flask1' : slot.id;
            const image = item ? itemImage(item,slot.icon) : {src:placeholderImage(emptyId,slot.id === 'flask1' ? 1 : 0,slot.icon,slot.id === 'offhand' ? weapons.offhandCategory : ''),actual:false};
            return `<button class="equip-slot ${item ? '' : 'empty'} ${blocked?'unavailable':''}" data-slot="${slot.id}" data-rarity="${rarity(item)}" aria-label="${blocked ? esc(label) : esc(label)+': '+esc(item?.name || 'not provided')}" style="left:${slot.x/460*100}%;top:${slot.y/350*100}%;width:${slot.w/460*100}%;height:${slot.h/350*100}%">${blocked?'':`<img class="${image.actual ? 'item-art' : 'slot-art'}" src="${image.src}" alt="">`}${item ? '' : `<span class="slot-label">${esc(label)}</span>`}</button>`;
        }).join('');
        this.equipment.querySelectorAll<HTMLButtonElement>('[data-gear-weapon]').forEach(button => button.onclick = () => {
            this.options.weapon = Number(button.dataset.gearWeapon) as 1 | 2; this.draw(); this.options.onChange({gearWeapon:this.options.weapon});
        });
        this.equipment.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach(button => {
            button.onpointerenter = () => { if (!this.pinned) this.show(button); };
            button.onpointerleave = () => { if (!this.pinned) this.dismiss(); };
            button.onfocus = () => { if (!this.pinned) this.show(button); };
            button.onblur = () => { if (!this.pinned) this.dismiss(); };
            button.onclick = () => {
                if (this.pinned === button) { this.dismiss(); return; }
                this.dismiss(); this.pinned = button; button.classList.add('pinned'); this.show(button);
            };
        });
    }
    private show(button: HTMLButtonElement) {
        if (this.anchor !== button) this.anchor?.removeAttribute('aria-describedby');
        this.anchor = button; button.setAttribute('aria-describedby',this.tooltip.id);
        const slot = equipmentSlots.find(s => s.id === button.dataset.slot)!;
        const item = itemForSlot(this.items,slot.id,this.options.weapon);
        const weapons=weaponSlotState(this.items,this.options.weapon);
        const label=slot.id==='weapon'?weapons.mainLabel:slot.id==='offhand'?weapons.offhandLabel:slot.label;
        this.tooltip.hidden = false; this.tooltip.classList.toggle('pinned',!!this.pinned);
        this.tooltip.innerHTML = itemTooltipMarkup(item,label,item ? this.options.notesFor?.(item) : undefined,!!this.pinned);
        this.tooltip.classList.remove('compact');
        this.tooltip.style.width='';
        if(this.tooltip.offsetHeight>innerHeight-16){this.tooltip.style.width=Math.min(480,innerWidth-16)+'px';}
        if(this.tooltip.offsetHeight>innerHeight-16)this.tooltip.classList.add('compact');
        const rect = button.getBoundingClientRect(), width = this.tooltip.offsetWidth;
        const x = rect.right + 12 + width <= innerWidth ? rect.right + 12 : rect.left - width - 12;
        this.tooltip.style.left = Math.max(8,Math.min(x,innerWidth-width-8))+'px';
        this.tooltip.style.top = Math.max(8,Math.min(rect.top,innerHeight-this.tooltip.offsetHeight-8))+'px';
        const close = this.tooltip.querySelector<HTMLButtonElement>('.inventory-tooltip-close'); if (close) close.onclick = () => this.dismiss();
    }
    private dismiss() {
        if (this.tooltip.contains(document.activeElement)) this.pinned?.focus();
        this.pinned?.classList.remove('pinned'); this.pinned = null;
        this.anchor?.removeAttribute('aria-describedby'); this.anchor = null; this.tooltip.hidden = true;
    }
    destroy() {
        document.removeEventListener('pointerdown',this.outside); document.removeEventListener('keydown',this.escape);
        this.root.removeEventListener('scroll',this.moved,true); window.removeEventListener('resize',this.moved);
        this.tooltip.remove();
    }
}

export function itemTooltipMarkup(item: Item | undefined, slotLabel: string, notes?: string, pinned=false): string {
    if(item)item=resolveItemIdentity(item);
    const r=rarity(item);
    return `${pinned ? '<button class="inventory-tooltip-close" aria-label="Unpin item details">×</button>' : ''}<div class="inventory-tooltip-body">${item?itemDetails(item):`<p class="reference-label">${slotLabel==='Uses both hands'?'The main-hand weapon uses both hands.':'This slot is not specified by the build.'}</p>`}</div>${notes?.trim()?`<section class="inventory-item-notes"><h4>Notes</h4><div>${esc(notes)}</div></section>`:''}<div class="inventory-tooltip-hint">${pinned?'Pinned · Press Escape to close':'Click to pin item details'}</div>`;
}
