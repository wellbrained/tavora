import{describe,expect,it}from'vitest';import{TOOLTIP_GAP,tooltipPlacement,type TooltipRect}from'./geometry';

const view={width:400,height:600};
const overlaps=(a:TooltipRect,b:TooltipRect)=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;

describe('tooltipPlacement',()=>{
 it('sits below the anchor with a gap, centred, the arrow on its middle',()=>{
  const anchor={left:180,top:100,right:220,bottom:130},p=tooltipPlacement(anchor,120,40,view);
  expect(p).toEqual({side:'bottom',left:140,top:130+TOOLTIP_GAP,width:120,arrow:60});
 });
 it('flips above when there is no room below',()=>{
  const p=tooltipPlacement({left:180,top:560,right:220,bottom:590},120,40,view);
  expect(p.side).toBe('top');expect(p.top+40).toBe(560-TOOLTIP_GAP);
 });
 it('stays inside the window near an edge and keeps the arrow on the anchor',()=>{
  const p=tooltipPlacement({left:10,top:100,right:40,bottom:130},200,40,view);
  expect(p.left).toBe(8);expect(p.left+p.arrow).toBe(25);
 });
 it('opens to the side when asked, centred on the anchor height',()=>{
  const p=tooltipPlacement({left:10,top:200,right:50,bottom:240},150,60,view,'right');
  expect(p).toMatchObject({side:'right',left:50+TOOLTIP_GAP,top:190,arrow:30});
 });
 it('never covers the anchor, wherever it is',()=>{
  for(const x of [0,120,360])for(const y of [0,280,570]){
   const anchor={left:x,top:y,right:x+40,bottom:y+30},p=tooltipPlacement(anchor,260,90,view);
   const card={left:p.left,top:p.top,right:p.left+p.width,bottom:p.top+90};
   expect(overlaps(card,anchor)).toBe(false);
   expect(card.left).toBeGreaterThanOrEqual(8);expect(card.right).toBeLessThanOrEqual(392);
  }
 });
});
