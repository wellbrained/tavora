// A small module for the panel dialog tests. It does not use the SDK: it speaks the wire protocol directly. Just added,
// it opens its dialog on its own at once (a welcome); window.probe.call sends anything else, such as a dialog after a press.

let port;
let nextId = 1;
const waiting = new Map();
const events = [];
window.probe = { events };

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

const show = (id, text) => (document.querySelector(`[data-testid="${id}"]`).textContent = text);

async function start() {
  port = await getPort();
  port.addEventListener("message", (event) => {
    const message = event.data;
    if (message?.id !== undefined && waiting.has(message.id)) {
      waiting.get(message.id)(message);
      waiting.delete(message.id);
    } else if (message?.event) {
      events.push(message);
      // Told its dialog is open, the page switches to what the dialog shows (like a settings page), here a red page.
      if (message.event === "panel.dialog") document.body.style.background = message.data?.open ? "rgb(200, 0, 0)" : "rgb(0, 200, 0)";
    }
  });
  port.start();
  await call("bridge.handshake", { protocol: 1, sdkVersion: "0.1.0" });
  const launch = await call("panel.getLaunch");
  show("probe-launch", launch.result?.reason ?? "none");
  if (launch.result?.reason === "add") {
    const answer = await call("panel.setDialog", { open: true, width: 480, height: 320 });
    show("probe-auto", answer.ok ? "opened" : answer.error?.code ?? "failed");
  }
  show("probe-status", "ready");
}

start();
