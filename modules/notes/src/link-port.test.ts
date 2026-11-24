import { expect, it } from "vitest";
import { normalizeLink } from "./notes";

// A web address with a port has a colon after its host, which is not a scheme.
it("takes a web address with a port", () => {
  expect(normalizeLink("example.com:8080/path")).toBe("https://example.com:8080/path");
  expect(normalizeLink("localhost:3000")).toBe("https://localhost:3000/");
});

it("still refuses what isn't a web address or mail", () => {
  expect(normalizeLink("javascript:alert(1)")).toBeNull();
  expect(normalizeLink("ftp://files.example.com")).toBeNull();
  expect(normalizeLink("mailto:me@example.com")).toBe("mailto:me@example.com");
  expect(normalizeLink("HTTPS://Example.com")).toBe("https://example.com/");
});
