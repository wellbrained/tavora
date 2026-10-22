export interface TooltipPoint{x:number;y:number}
export function tooltipPosition(at:TooltipPoint,width:number,height:number,viewport:{width:number;height:number}){
 const gap=16,right=viewport.width-at.x-gap,left=at.x-gap;
 const side=right>=220||right>=left?'right':'left';
 const available=Math.max(80,side==='right'?right:left),w=Math.min(360,viewport.width-24,available);
 return {width:w,left:Math.max(12,Math.min(viewport.width-w-12,side==='right'?at.x+gap:at.x-w-gap)),top:Math.max(12,Math.min(viewport.height-height-12,at.y+12))};
}
