import { describe, expect, it } from "vitest";
import { accountServiceUrl, DEFAULT_API_URL, serviceUrl } from "./service-url";

describe("serviceUrl", () => {
  it("is Tavora's service when nothing is given", () => {
    expect(serviceUrl()).toBe(DEFAULT_API_URL);
  });

  it("takes trailing slashes off", () => {
    expect(serviceUrl("http://127.0.0.1:8787///")).toBe("http://127.0.0.1:8787");
    expect(serviceUrl("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
  });
});

describe("accountServiceUrl", () => {
  it("ends in /v1/account on the service", () => {
    expect(accountServiceUrl({})).toBe(`${DEFAULT_API_URL}/v1/account`);
  });

  it("follows the api address, and the account address before it", () => {
    expect(accountServiceUrl({ apiUrl: "http://api.test/" })).toBe("http://api.test/v1/account");
    expect(accountServiceUrl({ apiUrl: "http://api.test/", accountUrl: "http://accounts.test//" })).toBe("http://accounts.test/v1/account");
  });
});
