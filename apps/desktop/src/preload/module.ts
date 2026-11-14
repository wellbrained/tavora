// Preload for module views. Runs sandboxed in an isolated world and exposes
// nothing to the module. It relays the bridge handshake (the module asks for
// a port, the host binds the port to this view's identity) and answers the
// host's heartbeat, which stops when the page's main thread is stuck. The port
// the module gets is one end of a channel that ends here, in relayBridge,
// which checks every message before the main process sees it.
import { ipcRenderer } from "electron";
import { HELLO_MESSAGE, PORT_MESSAGE, PROTOCOL_VERSION } from "@tavora/sdk/protocol";
import { countsAsPress } from "./press";
import { relayBridge } from "./relay";

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.type !== HELLO_MESSAGE) return;
  ipcRenderer.send("tavora:hello");
});

/** The current port passed lifecycle.dispose on to the page; a closing ping that came first waits for it. */
let disposeRelayed = false;
let closingPing: number | undefined;
// After the page's own message task, so its dispose handlers have run and sent their first saves.
const answerClosing = (token: number) => setTimeout(() => ipcRenderer.send("tavora:pong", token), 0);

ipcRenderer.on("tavora:port", (event) => {
  const [hostPort] = event.ports;
  if (!hostPort) return;
  const { port1, port2 } = new MessageChannel();
  disposeRelayed = false;
  closingPing = undefined;
  relayBridge(hostPort, port1, (name) => {
    if (name !== "lifecycle.dispose") return;
    disposeRelayed = true;
    if (closingPing !== undefined) answerClosing(closingPing);
    closingPing = undefined;
  });
  window.postMessage({ type: PORT_MESSAGE, v: PROTOCOL_VERSION }, window.location.origin, [port2]);
});

// Real clicks and key presses only (a script cannot make an event trusted). The host lets a
// module open a link only right after one, so a page cannot open links on its own.
// Every real event is reported (no throttle): a fast second click must count as its own gesture.
for (const type of ["pointerdown", "keydown"]) {
  window.addEventListener(
    type,
    (event) => {
      if (!countsAsPress(event)) return;
      ipcRenderer.send("tavora:gesture");
    },
    true,
  );
}

// The heartbeat's ping is answered at once. A closing panel's ping carries a number: it comes back once the page has
// had lifecycle.dispose, so the host waits for the saves that sends.
ipcRenderer.on("tavora:ping", (_event, token: unknown) => {
  if (typeof token !== "number") return ipcRenderer.send("tavora:pong");
  if (disposeRelayed) answerClosing(token);
  else closingPing = token;
});

// The host shows a panel see-through (or under a cover) until it has drawn. A frame callback runs just before a
// frame is drawn, and only while the page is shown; the second one runs once the first frame is out.
ipcRenderer.on("tavora:frame", (_event, requestId: unknown) => {
  if (typeof requestId !== "number") return;
  // Said at once, so a panel that never draws can tell whether the request came and whether the page thought it was shown.
  ipcRenderer.send("tavora:frame-seen", document.visibilityState);
  requestAnimationFrame(() => requestAnimationFrame(() => ipcRenderer.send("tavora:framed", requestId)));
});

// Keep the last point as well as the first: dropping the trailing event can
// reject a tooltip when the user crosses slots faster than the throttle.
let pointerSentAt=0;
let pointerTimer:ReturnType<typeof setTimeout>|undefined;
let latestPointer:{x:number;y:number}|null=null;
function sendPointer(){
 clearTimeout(pointerTimer);pointerTimer=undefined;
 if(!latestPointer)return;
 pointerSentAt=performance.now();ipcRenderer.send("tavora:pointer",latestPointer);
}
window.addEventListener("pointermove",event=>{
 if(!event.isTrusted)return;
 latestPointer={x:event.clientX,y:event.clientY};
 const wait=24-(performance.now()-pointerSentAt);
 if(wait<=0)sendPointer();else if(!pointerTimer)pointerTimer=setTimeout(sendPointer,wait);
},true);
for(const type of ["pointerdown","pointerover"] as const)window.addEventListener(type,event=>{
 if(!event.isTrusted)return;latestPointer={x:event.clientX,y:event.clientY};sendPointer();
},true);
window.addEventListener("pointerout",event=>{
 if(!event.isTrusted||event.relatedTarget!==null)return;
 clearTimeout(pointerTimer);pointerTimer=undefined;latestPointer=null;ipcRenderer.send("tavora:pointer",null);
},true);
