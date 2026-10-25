import { describe, expect, it } from "vitest";
import { supportTarget } from "./module-support";

describe("supportTarget", () => {
  it("opens an https address in the browser", () => {
    expect(supportTarget("https://example.com/feedback?x=1")).toEqual({ kind: "web", url: "https://example.com/feedback?x=1" });
  });

  it("opens an email address as a plain mailto link", () => {
    expect(supportTarget("dev+tavora@example.com")).toEqual({ kind: "mail", url: "mailto:dev+tavora@example.com" });
  });

  it("refuses anything else", () => {
    for (const bad of ["http://example.com", "javascript:alert(1)", "data:text/html,hi", "file:///C:/x", "mailto:a@example.com", "a?cc=x@example.com", "a@example.com\r\nbcc:x@example.com", "https://u:p@example.com", "", "hello"]) {
      expect(supportTarget(bad), bad).toBeNull();
    }
  });
});
