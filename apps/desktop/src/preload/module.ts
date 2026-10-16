// Preload for module views. Runs sandboxed in an isolated world and exposes
// nothing to the module. It relays the bridge handshake (the module asks for
// a port, the host binds the port to this view's identity) and answers the
// host's heartbeat, which stops when the page's main thread is stuck. The port
// the module gets is one end of a channel that ends here, in relayBridge,
// which checks every message before the main process sees it.
import { ipcRenderer } from "electron";
import { HELLO_MESSAGE, PORT_MESSAGE, PROTOCOL_VERSION } from "@tavora/sdk/protocol";
import { relayBridge } from "./relay";

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.type !== HELLO_MESSAGE) return;
  ipcRenderer.send("tavora:hello");
});

ipcRenderer.on("tavora:port", (event) => {
  const [hostPort] = event.ports;
  if (!hostPort) return;
  const { port1, port2 } = new MessageChannel();
  relayBridge(hostPort, port1);
  window.postMessage({ type: PORT_MESSAGE, v: PROTOCOL_VERSION }, window.location.origin, [port2]);
});

ipcRenderer.on("tavora:ping", () => ipcRenderer.send("tavora:pong"));
