import type {Item} from './model';
export function resolveItemIdentity<T extends Item>(item:T):T;
export function itemCategory(item?:Item):string;
export function weaponLabel(item?:Item,offhand?:boolean):string;
export function weaponSlotState(items:Item[],set:1|2):{main?:Item;offhand?:Item;mainLabel:string;offhandLabel:string;blocked:boolean;offhandCategory:string};
