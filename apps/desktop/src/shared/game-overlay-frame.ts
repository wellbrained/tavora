/**
 * The frame Tavora draws over a game overlay while the player arranges overlays: an outline to grab, edges to resize
 * and a close button. Static host markup only; the preload (preload/game-overlay.ts) adds the handles and the module's
 * name through the DOM, so no text from a module is ever parsed as markup.
 */
export const GAME_OVERLAY_FRAME_DOCUMENT = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'">
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:transparent;font:12px 'Segoe UI',sans-serif;user-select:none}
#frame{position:fixed;inset:0;border:2px dashed #7fb8ff;background:rgba(20,40,70,.28);cursor:move}
#name{position:absolute;left:6px;top:4px;max-width:calc(100% - 44px);padding:1px 6px;border-radius:4px;background:rgba(10,20,35,.85);color:#e8f0fb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
#close{position:absolute;right:4px;top:4px;width:22px;height:22px;padding:0;border:0;border-radius:4px;background:rgba(10,20,35,.85);color:#e8f0fb;font:16px/20px 'Segoe UI',sans-serif;cursor:pointer}
#close:hover{background:#b3261e}
.edge{position:absolute}
.edge[data-edge=l],.edge[data-edge=r]{top:8px;bottom:8px;width:8px;cursor:ew-resize}
.edge[data-edge=t],.edge[data-edge=b]{left:8px;right:8px;height:8px;cursor:ns-resize}
.edge[data-edge=l]{left:-2px}.edge[data-edge=r]{right:-2px}.edge[data-edge=t]{top:-2px}.edge[data-edge=b]{bottom:-2px}
.edge[data-edge=tl],.edge[data-edge=tr],.edge[data-edge=bl],.edge[data-edge=br]{width:14px;height:14px;background:#7fb8ff;border-radius:3px}
.edge[data-edge=tl]{left:-2px;top:-2px;cursor:nwse-resize}.edge[data-edge=br]{right:-2px;bottom:-2px;cursor:nwse-resize}
.edge[data-edge=tr]{right:-2px;top:-2px;cursor:nesw-resize}.edge[data-edge=bl]{left:-2px;bottom:-2px;cursor:nesw-resize}
</style><div id="frame"></div>`;
