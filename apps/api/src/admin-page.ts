/**
 * The review page, as three small files served by the admin app. No outside
 * resources, no inline script or style (the page's content security policy
 * allows only these files), and everything that came from a player is put in
 * with textContent, never as markup. Images are fetched with the token and shown
 * from blob addresses, since an image tag cannot send a header.
 */

export const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tavora icon review</title>
<link rel="stylesheet" href="/admin.css">
</head>
<body>
<header>
  <h1>Icon review</h1>
  <p id="status" role="status"></p>
  <button id="refresh" type="button">Refresh</button>
</header>
<nav role="tablist">
  <button id="tab-pending" class="tab" type="button" role="tab" data-tab="pending">Needs review</button>
  <button id="tab-hosted" class="tab" type="button" role="tab" data-tab="hosted">Hosted</button>
</nav>
<main>
  <section id="panel-pending" role="tabpanel">
    <p class="hint">Check that each icon really is the game's own, then approve it. Deny and block refuses the same file for ever.</p>
    <div id="pending" class="grid"></div>
  </section>
  <section id="panel-hosted" role="tabpanel" hidden>
    <p class="hint">Take down removes an icon at once, for a publisher's request. Release icons also have to be removed from the repository and deployed.</p>
    <input id="search" type="search" placeholder="Search by game name" autocomplete="off">
    <div id="hosted" class="grid"></div>
  </section>
</main>
<script src="/admin.js"></script>
</body>
</html>
`;

export const ADMIN_CSS = `
:root { color-scheme: dark; --bg: #14110f; --card: #1f1a17; --line: #3a312b; --text: #f1e9e1; --muted: #a89a8c; --gold: #e0a84a; --bad: #d9654f; --ok: #6fbf73; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, sans-serif; }
header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
h1 { font-size: 18px; margin: 0; }
h2 { font-size: 15px; margin: 0 0 4px; }
main { padding: 16px; max-width: 1200px; margin: 0 auto; }
section { margin-bottom: 32px; }
[hidden] { display: none !important; }
nav { display: flex; gap: 4px; padding: 8px 16px 0; border-bottom: 1px solid var(--line); }
.tab { border-radius: 6px 6px 0 0; border-bottom: none; margin-bottom: -1px; background: transparent; color: var(--muted); }
.tab[aria-selected="true"] { background: var(--card); color: var(--text); border-color: var(--gold); }
input[type="search"] { font: inherit; background: var(--card); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; width: 100%; max-width: 320px; margin: 0 0 12px; }
.hint, #status { color: var(--muted); margin: 0 0 12px; }
#status { margin: 0 auto 0 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.previews { display: flex; align-items: center; gap: 10px; }
.tile { width: 96px; height: 96px; border-radius: 24px; background: #6b4a2f; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.12); }
.tile img { width: 88%; height: 88%; object-fit: contain; }
.tile.small { width: 48px; height: 48px; border-radius: 12px; }
.light { background: #eee; border-radius: 8px; padding: 4px; }
.light img { width: 64px; height: 64px; display: block; }
.name { font-weight: 600; }
.meta { color: var(--muted); font-size: 12px; word-break: break-all; }
.warn { color: var(--bad); font-weight: 600; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
button { font: inherit; background: #2c2420; color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; cursor: pointer; }
button:hover { border-color: var(--gold); }
button.ok { border-color: var(--ok); color: var(--ok); }
button.bad { border-color: var(--bad); color: var(--bad); }
button:disabled { opacity: 0.5; cursor: default; }
.empty { color: var(--muted); }
`;

export const ADMIN_JS = `
"use strict";
const $ = (id) => document.getElementById(id);
const status = (text) => { $("status").textContent = text; };
let token = sessionStorage.getItem("adminToken") || "";
const urls = [];
let data = null;
let tab = "pending";
try { if (sessionStorage.getItem("adminTab") === "hosted") tab = "hosted"; } catch {}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function call(path, body) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: Object.assign({ "X-Admin-Token": token }, body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (response.status === 401) {
    sessionStorage.removeItem("adminToken");
    token = "";
    throw new Error("Wrong token.");
  }
  return response;
}

async function imageUrl(path) {
  const response = await call(path);
  if (!response.ok) return "";
  const url = URL.createObjectURL(await response.blob());
  urls.push(url);
  return url;
}

function pictures(url) {
  const box = el("div", "previews");
  const big = el("div", "tile");
  const small = el("div", "tile small");
  const light = el("div", "light");
  for (const holder of [big, small, light]) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    holder.appendChild(img);
    box.appendChild(holder);
  }
  return box;
}

function button(label, className, action) {
  const node = el("button", className, label);
  node.type = "button";
  node.addEventListener("click", async () => {
    node.disabled = true;
    try { await action(); await load(); } catch (error) { status(String(error.message || error)); node.disabled = false; }
  });
  return node;
}

function kb(bytes) { return (bytes / 1024).toFixed(1) + " KB"; }

async function pendingCard(row) {
  const card = el("div", "card");
  card.appendChild(pictures(await imageUrl("/api/pending/" + row.sha256 + ".png")));
  card.appendChild(el("div", "name", row.gameName || "(unknown game)"));
  card.appendChild(el("div", "meta", "id " + row.id + " · offered as \\u201c" + row.name + "\\u201d · from " + row.source));
  card.appendChild(el("div", "meta", kb(row.size) + " · offered " + row.count + (row.count === 1 ? " time" : " times") + " · first " + row.firstSeen.slice(0, 16).replace("T", " ")));
  card.appendChild(el("div", "meta", row.sha256.slice(0, 16) + "\\u2026"));
  if (row.hasIcon) card.appendChild(el("div", "warn", "This game already has a hosted icon."));
  const actions = el("div", "row");
  const approve = button("Approve", "ok", async () => {
    const response = await call("/api/approve", { sha256: row.sha256 });
    if (!response.ok) throw new Error((await response.json()).error || "Could not approve.");
  });
  approve.disabled = row.hasIcon;
  actions.appendChild(approve);
  actions.appendChild(button("Deny", "", () => call("/api/deny", { sha256: row.sha256, block: false })));
  actions.appendChild(button("Deny and block", "bad", () => call("/api/deny", { sha256: row.sha256, block: true })));
  card.appendChild(actions);
  return card;
}

async function hostedCard(icon) {
  const card = el("div", "card");
  card.appendChild(pictures(await imageUrl("/api/hosted/" + icon.id + ".png")));
  card.appendChild(el("div", "name", icon.names[0]));
  card.appendChild(el("div", "meta", "id " + icon.id + " · " + icon.origin + " · " + kb(icon.size)));
  card.appendChild(el("div", "meta", "also known as: " + icon.names.slice(1).join(", ")));
  const actions = el("div", "row");
  actions.appendChild(button("Take down", "bad", async () => {
    if (!confirm("Take down the icon for " + icon.names[0] + "?")) return;
    await call("/api/takedown", { id: icon.id, block: false });
  }));
  actions.appendChild(button("Take down and block", "bad", async () => {
    if (!confirm("Take down the icon for " + icon.names[0] + " and refuse this file for ever?")) return;
    await call("/api/takedown", { id: icon.id, block: true });
  }));
  card.appendChild(actions);
  return card;
}

async function fill(id, items, make, empty) {
  const holder = $(id);
  const cards = [];
  for (const item of items) cards.push(await make(item));
  holder.replaceChildren(...(cards.length ? cards : [el("p", "empty", empty)]));
}

async function render() {
  if (!data) return;
  for (const name of ["pending", "hosted"]) {
    $("tab-" + name).setAttribute("aria-selected", String(name === tab));
    $("panel-" + name).hidden = name !== tab;
  }
  $("tab-pending").textContent = "Needs review (" + data.pending.length + ")";
  $("tab-hosted").textContent = "Hosted (" + data.hosted.length + ")";
  for (const url of urls.splice(0)) URL.revokeObjectURL(url);
  // only the open tab loads its pictures
  if (tab === "pending") {
    await fill("pending", data.pending, pendingCard, "Nothing is waiting.");
    return;
  }
  const query = $("search").value.trim().toLowerCase();
  const shown = data.hosted.filter((icon) => !query || icon.id.includes(query) || icon.names.some((name) => name.toLowerCase().includes(query)));
  await fill("hosted", shown, hostedCard, data.hosted.length ? "No hosted icon matches." : "No icons are hosted.");
}

async function load() {
  if (!token) {
    token = prompt("Admin token") || "";
    if (!token) { status("A token is needed."); return; }
    sessionStorage.setItem("adminToken", token);
  }
  status("Loading\\u2026");
  try {
    const response = await call("/api/overview");
    data = await response.json();
    await render();
    status("Up to date.");
  } catch (error) {
    status(String(error.message || error));
  }
}

for (const name of ["pending", "hosted"]) {
  $("tab-" + name).addEventListener("click", () => {
    tab = name;
    try { sessionStorage.setItem("adminTab", name); } catch {}
    render().catch((error) => status(String(error.message || error)));
  });
}
$("search").addEventListener("input", () => { render().catch((error) => status(String(error.message || error))); });
$("refresh").addEventListener("click", load);
load();
`;
