// The memory host in @tavora/sdk/testing refuses links.open to this PC and the local network with a copy of Tavora's rule
// (the SDK can't import the app). This keeps the copy the same as isPrivateUrl: every address here gets the same answer.
import { describe, expect, it } from "vitest";
import { createMemoryHost } from "@tavora/sdk/testing";
import { isPrivateUrl, isWebUrl } from "./browser-url";

const ADDRESSES = [
  "http://localhost/",
  "http://localhost:5173/app",
  "http://dev.localhost/",
  "http://127.0.0.1/",
  "http://127.1.2.3/",
  "http://0.0.0.0/",
  "http://10.0.0.8/",
  "http://100.64.0.1/",
  "http://100.128.0.1/",
  "http://169.254.1.1/",
  "http://172.16.0.1/",
  "http://172.32.0.1/",
  "http://192.168.178.1/",
  "http://192.169.0.1/",
  "http://8.8.8.8/",
  "http://router/",
  "http://nas.local/",
  "http://printer.lan/",
  "http://box.home.arpa/",
  "http://svc.internal/",
  "http://fritz.box/",
  "http://myfritz.box/",
  "http://speedport.ip/",
  "http://router.asus.com/",
  "http://routerlogin.net/",
  "http://tplinkwifi.net/",
  "http://[::1]/",
  "http://[::]/",
  "http://[::ffff:127.0.0.1]/",
  "http://[::ffff:192.168.0.1]/",
  "http://[::ffff:8.8.8.8]/",
  "http://[fc00::1]/",
  "http://[fd12:3456::1]/",
  "http://[fe80::1]/",
  "http://[2001:4860:4860::8888]/",
  "https://example.com/",
  "https://www.example.co.uk/a?b#c",
  "https://LOCALHOST./",
];

describe("the memory host's local-address rule", () => {
  it("answers every address as Tavora's links.open does", async () => {
    const { sdk } = createMemoryHost();
    for (const address of ADDRESSES) {
      expect(isWebUrl(address), address).toBe(true);
      const refused = await sdk.links.open(address).then(
        () => false,
        (error: { code?: string }) => error.code === "PERMISSION_DENIED",
      );
      expect(refused, address).toBe(isPrivateUrl(address));
    }
  });
});
