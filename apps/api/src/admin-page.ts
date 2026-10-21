/**
 * The review page (icons, modules and reviews reported from the catalog, and requests to replace a publisher key), as three small files served by the admin app. No outside
 * resources, no inline script or style (the page's content security policy
 * allows only these files), and everything that came from a player is put in
 * with textContent, never as markup. Images are fetched with the token and shown
 * from blob addresses, since an image tag cannot send a header. Rows show at
 * once with a spinner in the logo, the pictures load side by side, and each one
 * is kept for the session; a hosted picture is also kept by the browser, under
 * an address that names its hash.
 */

export const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tavora review</title>
<link rel="stylesheet" href="/admin.css">
</head>
<body>
<header>
  <div class="bar">
    <h1>Review</h1>
    <nav role="tablist">
      <button id="tab-pending" class="tab" type="button" role="tab" data-tab="pending">Needs review</button>
      <button id="tab-hosted" class="tab" type="button" role="tab" data-tab="hosted">Hosted</button>
      <button id="tab-reports" class="tab" type="button" role="tab" data-tab="reports">Reports</button>
      <button id="tab-reviews" class="tab" type="button" role="tab" data-tab="reviews">Reviews</button>
      <button id="tab-keys" class="tab" type="button" role="tab" data-tab="keys">Keys</button>
    </nav>
    <p id="status" role="status"></p>
    <button id="refresh" type="button">Refresh</button>
  </div>
</header>
<main>
  <p id="catalog-full" class="alert" role="alert" hidden></p>
  <section id="panel-pending" role="tabpanel">
    <div id="bulk" class="bulk" hidden>
      <button id="approve-all" class="ok" type="button">Approve all</button>
      <button id="deny-all" class="bad" type="button">Deny all</button>
    </div>
    <div id="pending" class="grid"></div>
  </section>
  <section id="panel-hosted" role="tabpanel" hidden>
    <input id="search" type="search" placeholder="Search games" autocomplete="off">
    <div id="hosted" class="grid"></div>
  </section>
  <section id="panel-reports" role="tabpanel" hidden>
    <div id="reports" class="grid"></div>
  </section>
  <section id="panel-reviews" role="tabpanel" hidden>
    <p class="hint">Reported reviews. Hide takes the text and the publisher's reply off the module page; the stars still count.</p>
    <div id="reviews" class="grid"></div>
  </section>
  <section id="panel-keys" role="tabpanel" hidden>
    <div class="bulk">
      <button id="get-successions" type="button">successions.json</button>
      <button id="get-revocations" type="button">revocations.json</button>
    </div>
    <p class="hint">Each file holds every entry in force plus the waiting ones. Check it, sign it offline with <code>pnpm tavora-catalog-sign &lt;kind&gt; &lt;file&gt; --key &lt;catalogue key&gt; --out &lt;signed file&gt;</code>, then upload with <code>tavora-api-catalog set-list</code>. A request shows as done once the served list holds it.</p>
    <div id="keys" class="grid"></div>
  </section>
</main>
<script src="/admin.js"></script>
</body>
</html>
`;

export const ADMIN_CSS = `
:root { color-scheme: dark; --bg: #14110f; --card: #1f1a17; --line: #3a312b; --text: #f1e9e1; --muted: #a89a8c; --gold: #e0a84a; --bad: #d9654f; --ok: #6fbf73; }
@font-face { font-family: "Inter"; src: url(/inter.woff2) format("woff2"); font-weight: 100 900; font-display: swap; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 Inter, system-ui, sans-serif; }
header { border-bottom: 1px solid var(--line); }
.bar { display: flex; align-items: center; gap: 24px; max-width: 1280px; margin: 0 auto; padding: 12px 16px; flex-wrap: wrap; }
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 15px; margin: 0 0 4px; }
main { padding: 16px; max-width: 1280px; margin: 0 auto; }
section { margin-bottom: 32px; }
[hidden] { display: none !important; }
nav { display: flex; gap: 6px; }
.tab { background: transparent; color: var(--muted); }
.tab[aria-selected="true"] { background: var(--card); color: var(--text); border-color: var(--gold); }
input[type="search"] { font: inherit; font-size: 16px; background: var(--card); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 9px 12px; width: 100%; max-width: 320px; margin: 0 0 12px; }
#status { color: var(--muted); margin: 0 0 0 auto; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 8px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; display: flex; align-items: center; gap: 12px; min-width: 0; }
.tile { flex: none; width: 48px; height: 48px; border-radius: 12px; background: #6b4a2f; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.12); }
.tile img { width: 88%; height: 88%; object-fit: contain; border-radius: 9px; }
.tile.loading img, .tile.missing img { display: none; }
.tile.loading::after { content: ""; width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgb(255 255 255 / 0.2); border-top-color: var(--gold); animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .tile.loading::after { animation-duration: 2.4s; } }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.name { font-weight: 600; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badges { display: flex; gap: 4px; flex-wrap: wrap; }
.badge { font-size: 12px; line-height: 1; padding: 4px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
.badge.ok { border-color: var(--ok); color: var(--ok); }
.badge.bad { border-color: var(--bad); color: var(--bad); }
.badge.gold { border-color: var(--gold); color: var(--gold); }
.bulk { display: flex; gap: 8px; margin: 0 0 12px; }
.row { flex: none; display: flex; gap: 6px; }
button { font: inherit; font-size: 15px; font-weight: 500; background: #2c2420; color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 8px 14px; cursor: pointer; }
.row button { font-size: 13px; padding: 6px 10px; }
button:hover { border-color: var(--gold); }
button.ok { border-color: var(--ok); color: var(--ok); }
button.bad { border-color: var(--bad); color: var(--bad); }
button:disabled { opacity: 0.5; cursor: default; }
.empty { color: var(--muted); }
.hint { color: var(--muted); font-size: 13px; margin: 0 0 12px; }
.quote { margin: 6px 0 0; font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
.quote.reply { color: var(--muted); }
code { font-size: 12px; }
.alert { border: 1px solid var(--bad); color: var(--bad); border-radius: 8px; padding: 8px 12px; margin: 0 0 16px; }
`;

export const ADMIN_JS = `
"use strict";
const $ = (id) => document.getElementById(id);
const status = (text) => { $("status").textContent = text; };
let token = sessionStorage.getItem("adminToken") || "";
// picture address -> promise of its blob address ("" when it could not be loaded)
const pictures = new Map();
let data = null;
let tab = "pending";
const TABS = ["pending", "hosted", "reports", "reviews", "keys"];
try { const saved = sessionStorage.getItem("adminTab"); if (TABS.includes(saved)) tab = saved; } catch {}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function call(path, body, cache) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: Object.assign({ "X-Admin-Token": token }, body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined,
    cache: cache || "no-store",
  });
  if (response.status === 401) {
    sessionStorage.removeItem("adminToken");
    token = "";
    throw new Error("Wrong token.");
  }
  return response;
}

const pendingPicture = (row) => "/api/pending/" + row.sha256 + ".png";
const hostedPicture = (icon) => "/api/hosted/" + icon.id + ".png?v=" + icon.sha256;

// once per address; a hosted picture may come from the browser's cache, an offered one never does
function picture(path) {
  let url = pictures.get(path);
  if (!url) {
    url = call(path, undefined, path.startsWith("/api/hosted/") ? "default" : "no-store")
      .then(async (response) => (response.ok ? URL.createObjectURL(await response.blob()) : ""))
      .catch(() => "");
    url.then((value) => { if (!value && pictures.get(path) === url) pictures.delete(path); });
    pictures.set(path, url);
  }
  return url;
}

// lets go of the pictures nothing shows any more
function prune() {
  const wanted = new Set([...data.pending.map(pendingPicture), ...data.hosted.map(hostedPicture)]);
  for (const [path, url] of pictures) {
    if (wanted.has(path)) continue;
    pictures.delete(path);
    url.then((value) => { if (value) URL.revokeObjectURL(value); });
  }
}

// the tile spins until its picture is there
function logo(path) {
  const tile = el("div", "tile loading");
  const img = document.createElement("img");
  img.alt = "";
  img.addEventListener("load", () => tile.classList.remove("loading"));
  img.addEventListener("error", () => { tile.classList.remove("loading"); tile.classList.add("missing"); });
  tile.appendChild(img);
  picture(path).then((url) => {
    if (url) { img.src = url; return; }
    tile.classList.remove("loading");
    tile.classList.add("missing");
  });
  return tile;
}

function badge(text, className) {
  return el("span", "badge" + (className ? " " + className : ""), text);
}

// one row: logo (if any), name with its badges, then the buttons
function card(picture, name, badges, buttons) {
  const node = el("div", "card");
  if (picture) node.appendChild(picture);
  const info = el("div", "info");
  const title = el("div", "name", name);
  title.title = name;
  const tags = el("div", "badges");
  tags.append(...badges);
  info.append(title, tags);
  const actions = el("div", "row");
  actions.append(...buttons);
  node.append(info, actions);
  return node;
}

function button(label, className, action, hint) {
  const node = el("button", className, label);
  node.type = "button";
  if (hint) node.title = hint;
  node.addEventListener("click", async () => {
    node.disabled = true;
    try { await action(); await load(); } catch (error) { status(String(error.message || error)); node.disabled = false; }
  });
  return node;
}

function pendingCard(row) {
  const approve = button("Approve", "ok", async () => {
    const response = await call("/api/approve", { sha256: row.sha256 });
    if (!response.ok) throw new Error((await response.json()).error || "Couldn't approve.");
  });
  approve.disabled = row.hasIcon;
  return card(
    logo(pendingPicture(row)),
    row.gameName || "(unknown game)",
    [row.hasIcon ? badge("has an icon", "bad") : badge("new", "gold"), ...(row.custom ? [badge("custom game", "")] : [])],
    [
      approve,
      button("Deny", "bad", () => call("/api/deny", { sha256: row.sha256, block: false })),
      button("Block", "bad", async () => {
        if (!confirm("Deny this icon, never take this file again and stop its sender from sharing?")) return;
        await call("/api/deny", { sha256: row.sha256, block: true });
      }, "Deny, never take this file again, and stop its sender from sharing"),
    ],
  );
}

function hostedCard(icon) {
  const name = icon.names[0];
  return card(
    logo(hostedPicture(icon)),
    name,
    [badge(icon.origin, icon.origin === "release" ? "" : "ok")],
    [
      button("Take down", "bad", async () => {
        if (!confirm("Take down " + name + "?")) return;
        await call("/api/takedown", { id: icon.id, block: false });
      }),
      button("Block", "bad", async () => {
        if (!confirm("Take down " + name + " and never take this file again?")) return;
        await call("/api/takedown", { id: icon.id, block: true });
      }, "Take down and never take this file again"),
    ],
  );
}

function reportCard(report) {
  const toggle = report.listed
    ? button("Hide", "bad", async () => {
      if (!confirm("Hide " + report.name + " from the catalog?")) return;
      await call("/api/catalog/listed", { id: report.id, listed: false });
    })
    : button("Show", "ok", () => call("/api/catalog/listed", { id: report.id, listed: true }));
  return card(
    null,
    report.name + " " + report.version,
    [
      report.listed ? badge("in catalog", "ok") : badge("hidden", "bad"),
      badge(report.count + (report.count === 1 ? " report" : " reports"), "gold"),
    ],
    [toggle, button("Dismiss", "", () => call("/api/reports/dismiss", { sha256: report.sha256 }))],
  );
}

function reviewCard(report) {
  const review = report.review;
  const node = card(
    null,
    review.moduleName + " " + "\u2605".repeat(review.stars),
    [
      badge(report.count + (report.count === 1 ? " report" : " reports"), "gold"),
      badge(review.author || "(no name)", ""),
      badge(review.version, ""),
      ...(review.hidden ? [badge("hidden", "bad")] : []),
    ],
    [
      review.hidden
        ? button("Show", "ok", () => call("/api/reviews/hidden", { id: review.id, hidden: false }))
        : button("Hide", "bad", () => call("/api/reviews/hidden", { id: review.id, hidden: true })),
      button("Dismiss", "", () => call("/api/reviews/dismiss", { id: review.id })),
    ],
  );
  const info = node.querySelector(".info");
  info.appendChild(el("p", "quote", review.text || ""));
  if (review.reply) info.appendChild(el("p", "quote reply", "Reply: " + review.reply));
  return node;
}

const short = (fingerprint) => fingerprint.slice(0, 12) + "\u2026";
const DAY = 86400000;

function keyCard(request) {
  const asked = Date.parse(request.requestedAt);
  const linked = request.newLinkedAt ? Date.parse(request.newLinkedAt) : null;
  const badges = [
    badge(request.leaked ? "leaked" : "lost", request.leaked ? "bad" : "gold"),
    badge(request.status, request.status === "done" ? "ok" : request.status === "declined" ? "bad" : ""),
    badge(request.developer || "(no developer name)", ""),
    badge(request.email || "(no email)", ""),
    badge("asked " + new Date(asked).toLocaleString(), ""),
  ];
  // a replacement key linked just before the request is worth a second look: it may be someone else's
  if (linked !== null) badges.push(badge("new key linked " + new Date(linked).toLocaleString(), asked - linked < DAY ? "bad" : ""));
  const buttons = request.status === "waiting"
    ? [button("Decline", "bad", async () => {
      if (!confirm("Turn down replacing " + short(request.old) + "?")) return;
      await call("/api/keys/decline", { old: request.old });
    })]
    : [];
  const node = card(null, short(request.old) + " \u2192 " + short(request.new), badges, buttons);
  node.title = request.old + " \u2192 " + request.new + " (account " + request.account + ")";
  return node;
}

// fetched with the token, then saved from a blob address
async function download(kind) {
  const response = await call("/api/keys/" + kind + ".json");
  if (!response.ok) throw new Error("Couldn't get " + kind + ".json.");
  const url = URL.createObjectURL(await response.blob());
  const link = el("a");
  link.href = url;
  link.download = kind + ".json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// one call per offer, one after another; an offer that fails (say, its game got an icon a moment ago) is skipped
async function bulk(verb, past, rows, send) {
  if (!rows.length || !confirm(verb + " all " + rows.length + "?")) return;
  $("approve-all").disabled = $("deny-all").disabled = true;
  let done = 0;
  try {
    for (const row of rows) {
      status(verb + " " + (done + 1) + " of " + rows.length + "\u2026");
      const response = await send(row);
      if (response.ok) done++;
    }
  } finally {
    $("approve-all").disabled = $("deny-all").disabled = false;
  }
  await load();
  if (done < rows.length) status(past + " " + done + " of " + rows.length + ", skipped the rest.");
}

function fill(id, items, make, empty) {
  const cards = items.map(make);
  $(id).replaceChildren(...(cards.length ? cards : [el("p", "empty", empty)]));
}

async function render() {
  if (!data) return;
  for (const name of TABS) {
    $("tab-" + name).setAttribute("aria-selected", String(name === tab));
    $("panel-" + name).hidden = name !== tab;
  }
  $("tab-pending").textContent = "Needs review (" + data.pending.length + ")";
  $("tab-hosted").textContent = "Hosted (" + data.hosted.length + ")";
  $("tab-reports").textContent = "Reports (" + data.reports.length + ")";
  $("tab-reviews").textContent = "Reviews (" + data.reviews.length + ")";
  $("tab-keys").textContent = "Keys (" + data.keys.filter((request) => request.status === "waiting").length + ")";
  $("catalog-full").hidden = !data.catalogFullSince;
  if (data.catalogFullSince) $("catalog-full").textContent = "The module catalog is full since " + new Date(data.catalogFullSince).toLocaleString() + ". Uploads are refused until there is room.";
  // only the open tab loads its pictures
  $("bulk").hidden = !data.pending.length;
  if (tab === "pending") {
    fill("pending", data.pending, pendingCard, "All clear!");
    return;
  }
  if (tab === "reports") {
    fill("reports", data.reports, reportCard, "No reports. Nice!");
    return;
  }
  if (tab === "reviews") {
    fill("reviews", data.reviews, reviewCard, "No reported reviews.");
    return;
  }
  if (tab === "keys") {
    fill("keys", data.keys, keyCard, "No key requests.");
    return;
  }
  const query = $("search").value.trim().toLowerCase();
  const shown = data.hosted.filter((icon) => !query || icon.id.includes(query) || icon.names.some((name) => name.toLowerCase().includes(query)));
  fill("hosted", shown, hostedCard, data.hosted.length ? "No matches." : "No icons yet.");
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
    const catalog = await (await call("/api/reports")).json();
    data.reports = catalog.reports;
    data.catalogFullSince = catalog.catalogFullSince;
    data.keys = (await (await call("/api/keys")).json()).requests;
    data.reviews = (await (await call("/api/reviews")).json()).reports;
    prune();
    await render();
    status("Up to date.");
  } catch (error) {
    status(String(error.message || error));
  }
}

for (const name of TABS) {
  $("tab-" + name).addEventListener("click", () => {
    tab = name;
    try { sessionStorage.setItem("adminTab", name); } catch {}
    render().catch((error) => status(String(error.message || error)));
  });
}
$("search").addEventListener("input", () => { render().catch((error) => status(String(error.message || error))); });
$("refresh").addEventListener("click", load);
for (const kind of ["successions", "revocations"]) $("get-" + kind).addEventListener("click", () => download(kind).catch((error) => status(String(error.message || error))));
const pendingRows = () => (data ? data.pending : []);
$("approve-all").addEventListener("click", () => bulk("Approve", "Approved", pendingRows().filter((row) => !row.hasIcon), (row) => call("/api/approve", { sha256: row.sha256 })).catch((error) => status(String(error.message || error))));
$("deny-all").addEventListener("click", () => bulk("Deny", "Denied", pendingRows(), (row) => call("/api/deny", { sha256: row.sha256, block: false })).catch((error) => status(String(error.message || error))));
load();
`;
