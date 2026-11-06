import { describe, expect, it } from "vitest";
import { siteGroups, siteOf } from "./site-groups";

describe("siteGroups", () => {
  it("merges hosts of one site into one chip, listing every host behind it", () => {
    expect(siteGroups(["poe.ninja", "mobalytics.gg", "cdn.mobalytics.gg", "www.poe-vault.com"])).toEqual([
      { site: "poe.ninja", hosts: ["poe.ninja"] },
      { site: "mobalytics.gg", hosts: ["mobalytics.gg", "cdn.mobalytics.gg"] },
      { site: "poe-vault.com", hosts: ["www.poe-vault.com"] },
    ]);
  });

  it("names the site even when only subdomains are granted", () => {
    expect(siteGroups(["geocoding-api.open-meteo.com", "api.open-meteo.com"])).toEqual([
      { site: "open-meteo.com", hosts: ["geocoding-api.open-meteo.com", "api.open-meteo.com"] },
    ]);
  });

  it("keeps two-part suffixes such as co.uk", () => {
    expect(siteGroups(["api.bbc.co.uk", "www.bbc.co.uk", "news.example.co.uk"])).toEqual([
      { site: "bbc.co.uk", hosts: ["api.bbc.co.uk", "www.bbc.co.uk"] },
      { site: "example.co.uk", hosts: ["news.example.co.uk"] },
    ]);
  });

  it("leaves local programs, IP addresses and hosts without a public suffix as they are", () => {
    expect(siteOf("localhost:3000")).toBe("localhost:3000");
    expect(siteOf("127.0.0.1")).toBe("127.0.0.1");
    expect(siteOf("192.168.1.20")).toBe("192.168.1.20");
    expect(siteOf("[::1]:8080")).toBe("[::1]:8080");
    expect(siteOf("localhost")).toBe("localhost");
    expect(siteGroups(["localhost:3000", "localhost:4000"])).toEqual([
      { site: "localhost:3000", hosts: ["localhost:3000"] },
      { site: "localhost:4000", hosts: ["localhost:4000"] },
    ]);
  });

  it("keeps sites on a shared private suffix apart and lists a host only once", () => {
    expect(siteGroups(["a.github.io", "b.github.io", "a.github.io"]).map((group) => group.site)).toEqual(["a.github.io", "b.github.io"]);
  });
});
