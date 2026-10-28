// A small module for the leaderboards connector tests. It does not use the SDK: it speaks the wire protocol
// directly. The buttons call show and hide; window.probe holds what the host answered, and window.probe.call
// sends anything else (status, submit, top).

const results = [];
window.probe = { results };

let port;
let nextId = 1;
const waiting = new Map();

function getPort() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no port")), 3000);
    window.addEventListener("message", function onMessage(event) {
      if (event.data?.type !== "tavora:port" || !event.ports[0]) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(event.ports[0]);
    });
    window.postMessage({ type: "tavora:hello", v: 1 }, location.origin);
  });
}

function call(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    port.postMessage({ v: 1, id, method, ...(params === undefined ? {} : { params }) });
  });
}
window.probe.call = call;

/** Calls a method and keeps the answer for the test to read. */
async function run(label, method, params) {
  const answer = await call(method, params);
  results.push({ label, method, answer });
  return answer;
}

async function start() {
  port = await getPort();
  port.addEventListener("message", (event) => {
    const message = event.data;
    if (message?.id !== undefined && waiting.has(message.id)) {
      waiting.get(message.id)(message);
      waiting.delete(message.id);
    }
  });
  port.start();
  await call("bridge.handshake", { protocol: 1, sdkVersion: "0.1.0" });
  document.querySelector('[data-testid="probe-status"]').textContent = "ready";
}

const button = (id, action) => document.querySelector(`[data-testid="${id}"]`).addEventListener("click", action);
button("probe-show", () => run("show", "leaderboards.show"));
button("probe-hide", () => run("hide", "leaderboards.hide"));

start();
