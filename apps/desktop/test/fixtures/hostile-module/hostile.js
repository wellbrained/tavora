// A deliberately hostile module for the isolation gate tests. It does not use
// the SDK: it speaks the wire protocol directly, the way an attacker would.
// The tests call window.runProbes() and assert on the results.

const settle = (promise, ms = 3000) =>
  Promise.race([
    promise.then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error: String(error?.message ?? error) }),
    ),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "timeout" }), ms)),
  ]);

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

let nextId = 1;
function rpc(port, message) {
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true }), 3000);
    port.addEventListener("message", function onMessage(event) {
      if (event.data?.id !== id) return;
      clearTimeout(timer);
      port.removeEventListener("message", onMessage);
      resolve(event.data);
    });
    port.postMessage({ v: 1, id, ...message });
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve("loaded");
    img.onerror = () => reject(new Error("error"));
    img.src = src;
  });
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.onopen = () => resolve("open");
    socket.onerror = () => reject(new Error("error"));
  });
}

function xhr(url) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url);
    request.onload = () => resolve(request.status);
    request.onerror = () => reject(new Error("error"));
    request.send();
  });
}

window.runProbes = async ({ serverUrl, otherModuleUrl }) => {
  const results = {};

  results.globals = {
    require: typeof require,
    process: typeof process,
    module: typeof module,
    Buffer: typeof Buffer,
    ipcRenderer: typeof ipcRenderer,
    electron: typeof electron,
    tavoraHost: typeof window.tavoraHost,
  };

  const wsUrl = serverUrl.replace("http:", "ws:");
  results.network = {
    fetch: await settle(fetch(`${serverUrl}/fetch`)),
    fetchNoCors: await settle(fetch(`${serverUrl}/fetch-no-cors`, { mode: "no-cors" })),
    xhr: await settle(xhr(`${serverUrl}/xhr`)),
    image: await settle(loadImage(`${serverUrl}/image.png`)),
    webSocket: await settle(openSocket(`${wsUrl}/socket`)),
    beacon: (() => {
      try {
        return navigator.sendBeacon(`${serverUrl}/beacon`, "x");
      } catch {
        return false;
      }
    })(),
    file: await settle(fetch("file:///etc/hostname")),
    otherModule: await settle(fetch(otherModuleUrl).then((response) => response.status)),
  };

  results.windowOpen = window.open(`${serverUrl}/window-open`) === null ? "denied" : "opened";
  results.localStorageSecret = localStorage.getItem("secret");

  const port = await getPort();
  port.start();
  results.bridge = {
    // Protocol rules come before anything else.
    beforeHandshake: await rpc(port, { method: "game.getCurrent" }),
    futureProtocol: await rpc(port, { method: "bridge.handshake", params: { protocol: 2, sdkVersion: "9.9.9" } }),
    handshake: await rpc(port, { method: "bridge.handshake", params: { protocol: 1, sdkVersion: "0.1.0" } }),
    game: await rpc(port, { method: "game.getCurrent" }),
    gameWithSpoofedParams: await rpc(port, { method: "game.getCurrent", params: { gameId: "satisfactory" } }),
    spoofedStorageRead: await rpc(port, {
      method: "storage.get",
      params: { key: "count", moduleId: "local.example.vanilla-module", gameId: "poe2" },
    }),
    spoofedStorageWrite: await rpc(port, {
      method: "storage.set",
      params: { key: "count", value: 999, moduleId: "local.example.vanilla-module" },
    }),
    protoMethod: await rpc(port, { method: "__proto__" }),
    constructorMethod: await rpc(port, { method: "constructor" }),
    wrongVersion: await rpc(port, { v: 0, method: "game.getCurrent" }),
    nonJsonValue: await rpc(port, { method: "storage.set", params: { key: "d", value: new Date() } }),
    oversized: await rpc(port, { method: "storage.set", params: { key: "big", value: "x".repeat(9 * 1024 * 1024) } }),
    overQuota: await rpc(port, { method: "storage.set", params: { key: "big", value: "x".repeat(6 * 1024 * 1024) } }),
    traversalKey: await rpc(port, { method: "storage.set", params: { key: "../../../escape", value: 1 } }),
    traversalDocument: await rpc(port, {
      method: "documents.put",
      params: { id: "../../vanilla", title: "x", data: 1 },
    }),
    spoofedDocumentList: await rpc(port, {
      method: "documents.list",
      params: { moduleId: "local.example.vanilla-module" },
    }),
    // Capabilities nobody granted. The host must refuse them with a stable error.
    networkFetch: await rpc(port, { method: "network.fetch", params: { url: `${serverUrl}/bridge-fetch` } }),
    filesOpen: await rpc(port, { method: "files.open" }),
    clipboardRead: await rpc(port, { method: "clipboard.readText" }),
    sharedDataRead: await rpc(port, { method: "sharedData.read", params: { key: "x" } }),
  };

  return results;
};

window.tryNavigate = (url) => {
  location.href = url;
};

// Blocks the renderer's main thread for good, like an infinite loop in a module.
window.hang = () => {
  setTimeout(() => {
    for (;;);
  }, 0);
};
