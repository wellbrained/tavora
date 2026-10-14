// Preload for module views. Runs sandboxed in an isolated world and exposes
// nothing to the module. Its only job is to relay the bridge handshake: the
// module asks for a port, the host binds the port to this view's identity.
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
