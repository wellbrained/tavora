// The panel of the in-game layer test (test/e2e/in-game-layer.spec.ts). It speaks the wire protocol directly, as
// hostile.js does, so the test needs no build: a button that counts, a field to type in, and the count passed to its
// live view with panel.setLive. What it heard of panel.overGame is kept for the test, with when (Date.now()).
const seen = { heard: [], ready: false };
window.__layerTest = seen;

function getPort() {
  return new Promise((resolve) => {
    window.addEventListener("message", function onMessage(event) {
      if (event.data?.type !== "tavora:port" || !event.ports[0]) return;
      window.removeEventListener("message", onMessage);
      resolve(event.ports[0]);
    });
    window.postMessage({ type: "tavora:hello", v: 1 }, location.origin);
  });
}

const port = await getPort();
let nextId = 1;
const waiting = new Map();
port.onmessage = (event) => {
  const message = event.data;
  if (message?.v !== 1) return;
  if ("event" in message) {
    if (message.event === "panel.overGame") seen.heard.push({ over: message.data?.over === true, at: Date.now() });
    return;
  }
  waiting.get(message.id)?.(message);
  waiting.delete(message.id);
};
const call = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    port.postMessage({ v: 1, id, method, params });
  });

await call("bridge.handshake", { protocol: 1, sdkVersion: "0.1.0" });
let count = 0;
const shown = document.querySelector('[data-testid="count"]');
const live = () => call("panel.setLive", { state: { count } });
document.querySelector('[data-testid="count-up"]').addEventListener("click", () => {
  count += 1;
  shown.textContent = String(count);
  void live();
});
await live();
seen.ready = true;
