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
  sitemap: { hostname: "https://docs.mytavora.app" },
  lastUpdated: true,
  vite: { server: { host: "127.0.0.1", port: 4001, strictPort: true } },
  // Tavora ships one dark theme for now (see the style guide).
  appearance: "force-dark",
  head: [
    ["meta", { name: "theme-color", content: "#171412" }],
    ["link", { rel: "icon", type: "image/png", href: "/favicon.png" }],
  ],
  themeConfig: {
    logo: { src: "/tavora-emblem.svg", alt: "" },
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", link: "/reference/manifest" },
      { text: "SDK API", link: "/api/" },
      { text: "mytavora.app", link: "https://mytavora.app/" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Permissions and consent", link: "/guide/permissions" },
          { text: "Saving data", link: "/guide/saving-data" },
          { text: "Look and languages", link: "/guide/look-and-languages" },
          { text: "Several panels", link: "/guide/panels" },
          { text: "Your publisher key", link: "/guide/publisher-key" },
          { text: "Troubleshooting", link: "/guide/troubleshooting" },
          { text: "Security model", link: "/guide/security" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Module manifest", link: "/reference/manifest" },
          { text: "Bridge protocol", link: "/reference/protocol" },
          { text: "Theme packages", link: "/reference/theme" },
          { text: "SDK changelog", link: "/reference/changelog" },
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
