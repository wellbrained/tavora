import { defineConfig } from "vite";

// A module ships as one self-contained folder: relative paths, nothing loaded from the internet.
export default defineConfig({
  root: "src",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "chrome130",
    modulePreload: { polyfill: false },
  },
});
