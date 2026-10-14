import { defineConfig } from "vitepress";

// Written by TypeDoc (typedoc-vitepress-theme) during `pnpm generate`.
const apiSidebar = await import("../api/typedoc-sidebar.json", { with: { type: "json" } })
  .then((module) => module.default)
  .catch(() => []);

export default defineConfig({
  title: "Tavora Docs",
  description: "Build modules for Tavora: the SDK, the module manifest and the bridge protocol.",
  lang: "en",
  cleanUrls: true,
  lastUpdated: true,
  // Tavora ships one dark theme for now (see docs/design/style-guide.md).
  appearance: "force-dark",
  head: [["meta", { name: "theme-color", content: "#171412" }]],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", link: "/reference/manifest" },
      { text: "SDK API", link: "/api/" },
      { text: "mytavora.app", link: "https://mytavora.app/" },
    ],
    sidebar: [
      { text: "Guide", items: [{ text: "Getting started", link: "/guide/getting-started" }] },
      {
        text: "Reference",
        items: [
          { text: "Module manifest", link: "/reference/manifest" },
          { text: "Bridge protocol", link: "/reference/protocol" },
        ],
      },
      { text: "@tavora/sdk API", link: "/api/", collapsed: true, items: apiSidebar },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/wellbrained/tavora" }],
    editLink: {
      pattern: ({ filePath }) =>
        filePath.startsWith("api/")
          ? "https://github.com/wellbrained/tavora/tree/main/packages/sdk/src"
          : `https://github.com/wellbrained/tavora/edit/main/apps/docs/${filePath}`,
      text: "Edit this page on GitHub",
    },
    search: { provider: "local" },
    footer: { message: "Code under the MIT License. The Tavora name and logo are not covered by it." },
  },
});
