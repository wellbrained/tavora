// A small module for the Discord connector tests. It does not use the SDK: it speaks the wire protocol
// directly. The buttons call the connector; window.probe holds what the host answered and sent.

const results = [];
const events = [];
const states = [];
window.probe = { results, events, states };

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

/** Calls a method and keeps the answer for the test to read. */
async function run(label, method, params) {
  const answer = await call(method, params);
  results.push({ label, method, answer });
  return answer;
}
window.probe.call = call;

async function start() {
  port = await getPort();
  port.addEventListener("message", (event) => {
    const message = event.data;
    if (message?.id !== undefined && waiting.has(message.id)) {
      waiting.get(message.id)(message);
      waiting.delete(message.id);
    } else if (message?.event === "discord.event") events.push(message.data);
    else if (message?.event === "discord.state") states.push(message.data);
  });
  port.start();
  await call("bridge.handshake", { protocol: 1, sdkVersion: "0.1.0" });
  // Asking for the state starts the connection for this panel.
  await run("state", "discord.state");
  await run("subscribe", "discord.subscribe", { event: "VOICE_CHANNEL_SELECT" });
  document.querySelector('[data-testid="probe-status"]').textContent = "ready";
}

const button = (id, action) => document.querySelector(`[data-testid="${id}"]`).addEventListener("click", action);
button("probe-connect", () => run("connect", "discord.connect"));
button("probe-mute", () => run("mute", "discord.command", { command: "SET_VOICE_SETTINGS", args: { mute: true } }));
button("probe-join-11", () => run("join", "discord.command", { command: "SELECT_VOICE_CHANNEL", args: { channel_id: "11" } }));

start();
