// Tavora's icon review page on the tailnet (https://tavora-iconreview.<tailnet>.ts.net).
// The page runs on the server's 127.0.0.1:4011 and is never forwarded by Caddy. This process, started by
// tracker on this PC, keeps an SSH tunnel to it and answers on 127.0.0.1:<port> (tracker's tailnet proxy
// forwards the name there), adding the admin token itself so the page needs no password.
// Nothing on the server changes. Usage: node proxy.mjs <port>
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2]);
const tunnelPort = port + 11; // 127.0.0.1 only, never shared
const key = process.env.ICON_REVIEW_KEY ?? "D:/Server/vpn ssh-key-2026-10-05.key";
const remote = process.env.ICON_REVIEW_REMOTE ?? "root@100.64.0.1";
const tokenFile = process.env.ICON_REVIEW_TOKEN_FILE ?? "D:/Server/tavora-icon-admin-token.txt";
const tailnetName = process.env.ICON_REVIEW_NAME ?? "tavora-iconreview";
if (!Number.isInteger(port) || port < 1024 || port > 65000) throw new Error("Usage: node proxy.mjs <port>");

const token = readFileSync(tokenFile, "utf8").trim();
if (token.length < 24) throw new Error("The admin token file is empty or too short.");

// The page reads its token from sessionStorage; give it a placeholder so it never asks. The real token is
// added below, on the way to the server.
const PLACEHOLDER = 'try { sessionStorage.setItem("adminToken", "via-proxy"); } catch {}\n';

let tunnel;
let stopping = false;
function openTunnel() {
  tunnel = spawn("ssh.exe", [
    "-i", key, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30", "-N", "-L", `127.0.0.1:${tunnelPort}:127.0.0.1:4011`, remote,
  ], { stdio: "ignore", windowsHide: true });
  tunnel.on("exit", (code) => {
    if (stopping) return;
    console.error(`[icon-review] tunnel ended (${code}); retrying in 5 s`);
    setTimeout(openTunnel, 5000);
  });
}
openTunnel();

// Only this machine and the tailnet name may talk to the proxy: a web page cannot reach the token by
// pointing another name at 127.0.0.1 (DNS rebinding).
const hostOk = (host = "") => {
  const name = host.toLowerCase().replace(/:\d+$/, "");
  return name === "127.0.0.1" || name === "localhost" || name.startsWith(`${tailnetName}.`) && name.endsWith(".ts.net");
};

http.createServer((request, response) => {
  if (!hostOk(request.headers.host)) {
    response.writeHead(421, { "Content-Type": "text/plain" }).end("Wrong host.");
    return;
  }
  const headers = { ...request.headers, host: `127.0.0.1:${tunnelPort}`, "x-admin-token": token };
  delete headers["accept-encoding"]; // the page script is edited below, so it has to come uncompressed
  const upstream = http.request({ host: "127.0.0.1", port: tunnelPort, method: request.method, path: request.url, headers }, (reply) => {
    if (request.url?.split("?")[0] === "/admin.js" && reply.statusCode === 200) {
      const parts = [];
      reply.on("data", (part) => parts.push(part));
      reply.on("end", () => {
        const body = Buffer.concat([Buffer.from(PLACEHOLDER), ...parts]);
        const out = { ...reply.headers, "content-length": String(body.length) };
        response.writeHead(200, out).end(body);
      });
      return;
    }
    response.writeHead(reply.statusCode ?? 502, reply.headers);
    reply.pipe(response);
  });
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502, { "Content-Type": "text/plain" });
    response.end("The tunnel to the server is not up yet; try again in a few seconds.");
  });
  request.pipe(upstream);
}).listen(port, "127.0.0.1", () => console.log(`[icon-review] listening on 127.0.0.1:${port}`));

// Once an hour (and a few minutes after start), tell tracker when offers are waiting that it has not told about
// yet: tracker shows a Windows notification and sends the phones a push (POST /api/notify on this PC's tracker,
// project "Tavora-IconReview"). Offers already announced are remembered in notified.json beside this file,
// so a restart does not repeat them, and a failed notice is tried again next hour.
const tracker = process.env.ICON_REVIEW_TRACKER ?? "http://127.0.0.1:3300";
const projectId = Number(process.env.ICON_REVIEW_PROJECT_ID ?? 15);
const everyMinutes = Number(process.env.ICON_REVIEW_NOTIFY_MINUTES ?? 60);
const stateFile = join(dirname(fileURLToPath(import.meta.url)), "notified.json");
const readNotified = () => {
  try { return new Set(JSON.parse(readFileSync(stateFile, "utf8"))); } catch { return new Set(); }
};

function getOverview() {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port: tunnelPort, path: "/api/overview", headers: { "x-admin-token": token }, timeout: 15000 }, (reply) => {
      const parts = [];
      reply.on("data", (part) => parts.push(part));
      reply.on("end", () => (reply.statusCode === 200 ? resolve(JSON.parse(Buffer.concat(parts).toString("utf8"))) : reject(new Error(`overview ${reply.statusCode}`))));
    });
    request.on("timeout", () => request.destroy(new Error("overview timed out")));
    request.on("error", reject);
  });
}

async function checkForOffers() {
  try {
    const { pending } = await getOverview();
    const known = readNotified();
    const fresh = pending.filter((offer) => !known.has(offer.sha256));
    if (fresh.length === 0) {
      writeFileSync(stateFile, JSON.stringify(pending.map((offer) => offer.sha256)));
      return;
    }
    const names = [...new Set(fresh.map((offer) => offer.gameName || offer.name))].slice(0, 3).join(", ");
    const response = await fetch(`${tracker}/api/notify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: pending.length === 1 ? "1 icon needs review" : `${pending.length} icons need review`,
        body: `New: ${names}. Open the Tavora icon review page.`,
        projectId,
        tag: "tavora-icon-review",
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`notify ${response.status}`);
    writeFileSync(stateFile, JSON.stringify(pending.map((offer) => offer.sha256)));
    console.log(`[icon-review] told tracker about ${fresh.length} new offer(s)`);
  } catch (error) {
    console.error(`[icon-review] offer check failed: ${error instanceof Error ? error.message : error}`);
  }
}
setTimeout(checkForOffers, Number(process.env.ICON_REVIEW_FIRST_CHECK_SECONDS ?? 180) * 1000);
setInterval(checkForOffers, everyMinutes * 60 * 1000);

const stop = () => { stopping = true; tunnel?.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
