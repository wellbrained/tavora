// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { tabOverflow } from "@tavora/official-ui/components/ui/tabs";
import { themeOf } from "@tavora/sdk/testing";
import { previewStyle } from "./style-preview";

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

describe("previewStyle", () => {
  it("keeps the user's Too many tabs while it shows another style", () => {
    const host = { ...themeOf("dark"), toasts: "top-center" as const, tabOverflow: "arrows" as const };
    previewStyle("tavora.classic", "", host);
    expect(tabOverflow.value).toBe("arrows");
  });
});
