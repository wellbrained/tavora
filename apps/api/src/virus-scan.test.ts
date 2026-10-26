import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clamdScan, createClamdScanner, createClamscanScanner, parseClamdReply, scannerFromEnv } from "./virus-scan.ts";

describe("clamd's answers", () => {
  it("reads OK as clean and FOUND as the threat's name, and anything else as an error", () => {
    expect(parseClamdReply("stream: OK\0")).toBeNull();
    expect(parseClamdReply("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toBe("Win.Test.EICAR_HDB-1");
    for (const bad of ["INSTREAM size limit exceeded. ERROR\0", "stream: Can't open file ERROR\0", "", "stream: OK but not really", "OK"]) {
      expect(() => parseClamdReply(bad), bad).toThrow(/clamd answered/);
    }
  });
});

/** A pretend clamd on a local port: reads one INSTREAM and answers as `reply` says about what it received. */
function fakeClamd(reply: (received: Buffer) => string | null) {
  const received: Buffer[] = [];
  const server = net.createServer((socket) => {
    let data = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      data = Buffer.concat([data, chunk]);
      const header = Buffer.from("zINSTREAM\0");
      if (!data.subarray(0, header.length).equals(header)) return;
      // [4 bytes length][bytes]... then a zero length.
      let at = header.length;
      const parts: Buffer[] = [];
      for (;;) {
        if (data.length < at + 4) return;
        const length = data.readUInt32BE(at);
        if (length === 0) break;
        if (data.length < at + 4 + length) return;
        parts.push(data.subarray(at + 4, at + 4 + length));
        at += 4 + length;
      }
      const body = Buffer.concat(parts);
      received.push(body);
      const answer = reply(body);
      if (answer === null) return;
      socket.end(`${answer}\0`);
    });
  });
  return new Promise<{ port: number; received: Buffer[]; close: () => void }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as net.AddressInfo).port, received, close: () => server.close() })),
  );
}

describe("scanning through clamd", () => {
  const closers: (() => void)[] = [];
  afterEach(() => {
    for (const close of closers.splice(0)) close();
  });

  it("sends the bytes as an INSTREAM and reports clean and infected", async () => {
    const clamd = await fakeClamd((body) => (body.includes("EICAR") ? "stream: Eicar-Test-Signature FOUND" : "stream: OK"));
    closers.push(clamd.close);
    expect(await clamdScan({ port: clamd.port }, Buffer.alloc(200_000, "a"), 2000)).toBeNull();
    expect(clamd.received[0]!.length).toBe(200_000);
    expect(await clamdScan({ port: clamd.port }, Buffer.from("xx EICAR xx"), 2000)).toBe("Eicar-Test-Signature");
  });

  it("scans the zip and every file, and names the file with the threat", async () => {
    const clamd = await fakeClamd((body) => (body.toString().includes("EICAR") ? "stream: Eicar-Test-Signature FOUND" : "stream: OK"));
    closers.push(clamd.close);
    const scanner = createClamdScanner({ port: clamd.port }, { timeoutMs: 2000 });
    const files = [
      { name: "index.html", data: Buffer.from("<p>hi</p>") },
      { name: "evil.js", data: Buffer.from("EICAR") },
      { name: "empty.txt", data: Buffer.alloc(0) },
    ];
    expect(await scanner.scan(Buffer.from("zip bytes"), files.slice(0, 1))).toEqual({ clean: true });
    expect(await scanner.scan(Buffer.from("zip bytes"), files)).toEqual({ clean: false, threats: ["Eicar-Test-Signature in evil.js"] });
  });

  it("throws, never answers clean, when clamd is not there, answers an error, hangs up or is too slow", async () => {
    const free = await new Promise<number>((resolve) => {
      const probe = net.createServer().listen(0, "127.0.0.1", () => {
        const port = (probe.address() as net.AddressInfo).port;
        probe.close(() => resolve(port));
      });
    });
    await expect(createClamdScanner({ port: free }, { timeoutMs: 500 }).scan(Buffer.from("z"), [])).rejects.toThrow(/not reachable/);

    const erroring = await fakeClamd(() => "INSTREAM size limit exceeded. ERROR");
    closers.push(erroring.close);
    await expect(createClamdScanner({ port: erroring.port }, { timeoutMs: 500 }).scan(Buffer.from("z"), [])).rejects.toThrow(/clamd answered/);

    const silent = await fakeClamd(() => null);
    closers.push(silent.close);
    await expect(createClamdScanner({ port: silent.port }, { timeoutMs: 300 }).scan(Buffer.from("z"), [])).rejects.toThrow(/in time/);

    // Hangs up without a word: an empty answer is an error too.
    const hangup = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => hangup.listen(0, "127.0.0.1", resolve));
    closers.push(() => hangup.close());
    await expect(createClamdScanner({ port: (hangup.address() as net.AddressInfo).port }, { timeoutMs: 500 }).scan(Buffer.from("z"), [])).rejects.toThrow();
  });

  it("refuses to call a file clean that clamd cannot take whole", async () => {
    const clamd = await fakeClamd(() => "stream: OK");
    closers.push(clamd.close);
    const huge = { name: "huge.bin", data: Buffer.alloc(21 * 1024 * 1024) };
    await expect(createClamdScanner({ port: clamd.port }, { timeoutMs: 2000 }).scan(Buffer.from("z"), [huge])).rejects.toThrow(/too big to scan/);
  });
});

describe("scanning through the clamscan command", () => {
  /** A pretend clamscan: a node script that "finds" any file holding EICAR, exits 1 for it, 0 otherwise, 2 for ERROR. */
  function fakeClamscan() {
    const dir = mkdtempSync(path.join(tmpdir(), "tavora-fake-clamscan-"));
    const script = path.join(dir, "clamscan.mjs");
    writeFileSync(
      script,
      `import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
const folder = process.argv.at(-1);
let found = 0;
for (const name of readdirSync(folder)) {
  const text = readFileSync(path.join(folder, name), "utf8");
  if (text.includes("BROKEN")) process.exit(2);
  if (text.includes("EICAR")) { console.log(path.join(folder, name) + ": Eicar-Test-Signature FOUND"); found = 1; }
}
process.exit(found);
`,
    );
    return { command: process.execPath, args: [script] };
  }

  it("reports clean and infected, names the file, and removes what it wrote", async () => {
    const scanner = createClamscanScanner(fakeClamscan());
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith("tavora-scan-"));
    expect(await scanner.scan(Buffer.from("zip"), [{ name: "a.js", data: Buffer.from("fine") }])).toEqual({ clean: true });
    expect(await scanner.scan(Buffer.from("zip"), [{ name: "a.js", data: Buffer.from("fine") }, { name: "../evil.js", data: Buffer.from("EICAR") }])).toEqual({
      clean: false,
      threats: ["Eicar-Test-Signature in ../evil.js"],
    });
    expect(readdirSync(tmpdir()).filter((name) => name.startsWith("tavora-scan-"))).toEqual(before);
  });

  it("throws on an error exit, a missing command and a command that is too slow", async () => {
    await expect(createClamscanScanner(fakeClamscan()).scan(Buffer.from("zip"), [{ name: "a.js", data: Buffer.from("BROKEN") }])).rejects.toThrow(/exited with 2/);
    await expect(createClamscanScanner({ command: "definitely-not-clamscan-xyz" }).scan(Buffer.from("zip"), [])).rejects.toThrow(/could not run/);
    const slow = path.join(mkdtempSync(path.join(tmpdir(), "tavora-fake-clamscan-")), "slow.mjs");
    writeFileSync(slow, "setTimeout(() => {}, 10000);");
    await expect(createClamscanScanner({ command: process.execPath, args: [slow], timeoutMs: 300 }).scan(Buffer.from("zip"), [])).rejects.toThrow(/in time/);
  });
});

describe("the scanner the server is set up for", () => {
  it("is none without settings, so every version waits", () => {
    expect(scannerFromEnv({})).toBeUndefined();
    expect(scannerFromEnv({ CLAMD_SOCKET: " ", CLAMD_HOST: "", CLAMSCAN_PATH: "  " })).toBeUndefined();
  });

  it("uses the socket, then the host, then the command", () => {
    for (const env of [{ CLAMD_SOCKET: "/run/clamav/clamd.ctl" }, { CLAMD_HOST: "127.0.0.1", CLAMD_PORT: "3310" }, { CLAMD_HOST: "127.0.0.1", CLAMD_PORT: "nope" }, { CLAMSCAN_PATH: "/usr/bin/clamscan" }]) {
      expect(scannerFromEnv(env)).toBeDefined();
    }
  });
});
