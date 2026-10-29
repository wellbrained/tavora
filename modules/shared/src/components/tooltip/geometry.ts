export interface TooltipPoint{x:number;y:number}
/** The box of the thing a tooltip is for, in viewport pixels. */
export interface TooltipRect{left:number;top:number;right:number;bottom:number}
export type TooltipSide='top'|'bottom'|'left'|'right';
export interface TooltipPlacement{left:number;top:number;width:number;side:TooltipSide;/** Where the arrow sits along the card's edge that faces the anchor. */arrow:number}

/** Space between the anchor and the card; the arrow fills half of it. */
export const TOOLTIP_GAP=10;
const MARGIN=8,EDGE=12,MAX_WIDTH=280;
const OPPOSITE:Record<TooltipSide,TooltipSide>={top:'bottom',bottom:'top',left:'right',right:'left'};

/** A pointer position as an anchor: a box around the cursor, so the card never covers it. */
export function pointAnchor(at:TooltipPoint):TooltipRect{return{left:at.x-4,top:at.y-4,right:at.x+12,bottom:at.y+20}}

/** Puts a card of the given size beside `anchor`, never on it: on the preferred side, else the one with room, inside the viewport. */
export function tooltipPlacement(anchor:TooltipRect,width:number,height:number,viewport:{width:number;height:number},prefer:TooltipSide='bottom'):TooltipPlacement{
 const room:Record<TooltipSide,number>={top:anchor.top-TOOLTIP_GAP-MARGIN,bottom:viewport.height-anchor.bottom-TOOLTIP_GAP-MARGIN,left:anchor.left-TOOLTIP_GAP-MARGIN,right:viewport.width-anchor.right-TOOLTIP_GAP-MARGIN};
 const cap=Math.min(MAX_WIDTH,viewport.width-2*MARGIN),w0=Math.min(cap,width||cap);
 const fits=(side:TooltipSide)=>side==='top'||side==='bottom'?room[side]>=height:room[side]>=Math.min(w0,220)&&height<=viewport.height-2*MARGIN;
 const order:TooltipSide[]=[prefer,OPPOSITE[prefer],...(prefer==='top'||prefer==='bottom'?['right','left']:['bottom','top']) as TooltipSide[]];
 const side=order.find(fits)??(room.bottom>=room.top?'bottom':'top');
 const w=side==='left'||side==='right'?Math.max(80,Math.min(w0,room[side])):w0;
 const cx=(anchor.left+anchor.right)/2,cy=(anchor.top+anchor.bottom)/2;
 const clampX=(x:number)=>Math.max(MARGIN,Math.min(viewport.width-w-MARGIN,x)),clampY=(y:number)=>Math.max(MARGIN,Math.min(viewport.height-height-MARGIN,y));
 const left=side==='left'?anchor.left-TOOLTIP_GAP-w:side==='right'?anchor.right+TOOLTIP_GAP:clampX(cx-w/2);
 const top=side==='top'?anchor.top-TOOLTIP_GAP-height:side==='bottom'?anchor.bottom+TOOLTIP_GAP:clampY(cy-height/2);
 const along=side==='top'||side==='bottom'?cx-left:cy-top,length=side==='top'||side==='bottom'?w:height;
 return{left,top,width:w,side,arrow:Math.max(EDGE,Math.min(length-EDGE,along))};
}
