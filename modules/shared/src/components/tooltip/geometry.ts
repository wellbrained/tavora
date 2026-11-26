export interface TooltipPoint{x:number;y:number}
/** The box of the thing a tooltip is for, in viewport pixels. */
export interface TooltipRect{left:number;top:number;right:number;bottom:number}
export type TooltipSide='top'|'bottom'|'left'|'right';
/** Where the card lines up along its element: centred, or with the element's start or end (a hint on a whole row or field). */
export type TooltipAlign='center'|'start'|'end';
export interface TooltipPlacement{left:number;top:number;width:number;side:TooltipSide;/** Where the arrow sits along the card's edge that faces the anchor. */arrow:number;/** The tallest the card may be, the viewport less its margin: a taller one scrolls. */maxHeight:number;/** There was no room beside the anchor and the card lies over it: it takes no arrow. */covers:boolean}

/** Space between the anchor and the card; the arrow fills half of it. */
export const TOOLTIP_GAP=10;
const MARGIN=8,EDGE=12;
/** The widest a card gets by default (`width="sm"`). */
export const TOOLTIP_MAX_WIDTH=280;
const OPPOSITE:Record<TooltipSide,TooltipSide>={top:'bottom',bottom:'top',left:'right',right:'left'};

/** A pointer position as an anchor: a box around the cursor, so the card never covers it. */
export function pointAnchor(at:TooltipPoint):TooltipRect{return{left:at.x-4,top:at.y-4,right:at.x+12,bottom:at.y+20}}

/**
 * Puts a card of the given size beside `anchor`, never on it: on the preferred side, else the one with room, inside the viewport.
 * `maxWidth` is the widest the card may get; the viewport still narrows it. A `rigid` card (an item card, which has its
 * own width) never gets narrower beside the anchor: it goes to a side with room for all of it instead. `align` lines the
 * card up with the anchor's start or end instead of its middle; the arrow then points near that end of the anchor.
 * A card never leaves the viewport: one taller than it gets `maxHeight` (and scrolls), and one with no room beside the
 * anchor is moved inside, over the anchor, instead of being cut off.
 */
export function tooltipPlacement(anchor:TooltipRect,width:number,height:number,viewport:{width:number;height:number},prefer:TooltipSide='bottom',maxWidth=TOOLTIP_MAX_WIDTH,rigid=false,align:TooltipAlign='center'):TooltipPlacement{
 const room:Record<TooltipSide,number>={top:anchor.top-TOOLTIP_GAP-MARGIN,bottom:viewport.height-anchor.bottom-TOOLTIP_GAP-MARGIN,left:anchor.left-TOOLTIP_GAP-MARGIN,right:viewport.width-anchor.right-TOOLTIP_GAP-MARGIN};
 const cap=Math.min(maxWidth,viewport.width-2*MARGIN),w0=Math.min(cap,width||cap);
 const maxHeight=Math.max(1,viewport.height-2*MARGIN),h=Math.min(height,maxHeight);
 const fits=(side:TooltipSide)=>side==='top'||side==='bottom'?room[side]>=h:room[side]>=(rigid?w0:Math.min(w0,220));
 const order:TooltipSide[]=[prefer,OPPOSITE[prefer],...(prefer==='top'||prefer==='bottom'?['right','left']:['bottom','top']) as TooltipSide[]];
 const side=order.find(fits)??(room.bottom>=room.top?'bottom':'top');
 const w=(side==='left'||side==='right')&&!rigid?Math.max(80,Math.min(w0,room[side])):w0;
 const cx=(anchor.left+anchor.right)/2,cy=(anchor.top+anchor.bottom)/2;
 // Where along the anchor the arrow points: its middle, or near its start or end (at most 20 px in) on a wide anchor.
 const aim=(from:number,to:number)=>align==='start'?from+Math.min((to-from)/2,20):align==='end'?to-Math.min((to-from)/2,20):(from+to)/2;
 const ax=aim(anchor.left,anchor.right),ay=aim(anchor.top,anchor.bottom);
 const lineX=align==='start'?anchor.left:align==='end'?anchor.right-w:cx-w/2,lineY=align==='start'?anchor.top:align==='end'?anchor.bottom-h:cy-h/2;
 const clampX=(x:number)=>Math.max(MARGIN,Math.min(viewport.width-w-MARGIN,x)),clampY=(y:number)=>Math.max(MARGIN,Math.min(viewport.height-h-MARGIN,y));
 const left=side==='left'?anchor.left-TOOLTIP_GAP-w:side==='right'?anchor.right+TOOLTIP_GAP:clampX(lineX);
 const beside=side==='top'?anchor.top-TOOLTIP_GAP-h:side==='bottom'?anchor.bottom+TOOLTIP_GAP:undefined;
 // Not yet measured (height 0): where it would go. Measured: kept inside.
 const top=beside===undefined?clampY(lineY):height?clampY(beside):beside;
 const covers=beside!==undefined&&top!==beside&&top<anchor.bottom&&top+h>anchor.top;
 const along=side==='top'||side==='bottom'?ax-left:ay-top,length=side==='top'||side==='bottom'?w:h;
 return{left,top,width:w,side,arrow:Math.max(EDGE,Math.min(length-EDGE,along)),maxHeight,covers};
}
