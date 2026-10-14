// Preload for module views. Runs sandboxed in an isolated world and exposes
// nothing to the module. It relays the bridge handshake (the module asks for
// a port, the host binds the port to this view's identity) and answers the
// host's heartbeat, which stops when the page's main thread is stuck.
import { ipcRenderer } from "electron";
import { HELLO_MESSAGE, PORT_MESSAGE, PROTOCOL_VERSION } from "@tavora/sdk/protocol";

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.type !== HELLO_MESSAGE) return;
  ipcRenderer.send("tavora:hello");
});

ipcRenderer.on("tavora:port", (event) => {
  const [port] = event.ports;
  if (port) window.postMessage({ type: PORT_MESSAGE, v: PROTOCOL_VERSION }, window.location.origin, [port]);
});

ipcRenderer.on("tavora:ping", () => ipcRenderer.send("tavora:pong"));
