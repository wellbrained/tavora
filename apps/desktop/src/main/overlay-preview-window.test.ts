import { describe, expect, it, vi } from "vitest";

// The document is made without Electron; the module imports it, so it is stood in for.
vi.mock("electron", () => ({ BrowserWindow: class {}, WebContentsView: class {}, session: {}, app: { on: () => undefined } }));

const { PREVIEW_BACKGROUNDS, PREVIEW_FOOTER, previewChromeDocument } = await import("./overlay-preview-window");

describe("the preview window's backdrop and footer", () => {
  const labels = { dark: "Dark", light: "Light", checker: "Checkered" };

  it("offers a dark, a light and a checkered background, dark first", () => {
    expect(PREVIEW_BACKGROUNDS).toEqual(["dark", "light", "checker"]);
    const html = previewChromeDocument(labels);
    expect(html).toContain('data-bg="dark">');
    for (const [id, label] of Object.entries(labels)) expect(html).toContain(`data-bg="${id}" aria-pressed="${id === "dark"}">${label}</button>`);
    expect(PREVIEW_FOOTER).toBeGreaterThan(0);
  });

  it("escapes the labels, and loads nothing from anywhere", () => {
    const html = previewChromeDocument({ dark: "<b>x</b>", light: 'a"b', checker: "c&d" });
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&#60;b&#62;x&#60;/b&#62;");
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/https?:|src=/);
  });
});
