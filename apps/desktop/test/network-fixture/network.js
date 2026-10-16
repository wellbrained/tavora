// A module that asks for two hosts, for the network grant e2e test. Like the hostile module it
// speaks the wire protocol directly; the test calls window.handshake() and window.request(params).

const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("no port")), 3000);
  window.addEventListener("message", function onMessage(event) {
    if (event.data?.type !== "tavora:port" || !event.ports[0]) return;
    clearTimeout(timer);
    window.removeEventListener("message", onMessage);
    resolve(event.ports[0]);
  });
  window.postMessage({ type: "tavora:hello", v: 1 }, location.origin);
});
port.start();

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true }), 20000);
    port.addEventListener("message", function onMessage(event) {
      if (event.data?.id !== id) return;
      clearTimeout(timer);
      port.removeEventListener("message", onMessage);
      resolve(event.data);
    });
    port.postMessage({ v: 1, id, method, params });
  });
}

const handshake = rpc("bridge.handshake", { protocol: 1, sdkVersion: "0.1.0" });
window.handshake = () => handshake;
window.request = async (params) => (await handshake, rpc("network.fetch", params));
// The page itself still has no network, whatever was granted.
window.directFetch = (url) => fetch(url).then(
  (response) => `reached ${response.status}`,
  () => "blocked",
);
