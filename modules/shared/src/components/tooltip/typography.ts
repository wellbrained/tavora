/** Readable type sizes shared by module hover cards and the host-owned rich tooltip. */
export const TOOLTIP_TYPE={title:18,text:14,meta:14,small:12} as const;
export const TOOLTIP_TOKENS=Object.entries(TOOLTIP_TYPE).map(([key,value])=>'--tavora-tooltip-'+key+'-size:'+value+'px').join(';');
/**
 * Item cards (`layout: "card"`, the kit's `ItemCard`): the title and the effect box, larger on a skinned card, where they
 * may be in the skin's font; badges and the footer are `small` (the kit's small size); everything else is `text`.
 */
export const ITEM_CARD_TYPE={title:15,effect:13,text:13,small:12,skinTitle:17,skinEffect:15} as const;
export const ITEM_CARD_TOKENS=Object.entries(ITEM_CARD_TYPE).map(([key,value])=>'--tavora-card-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+'-size:'+value+'px').join(';');
