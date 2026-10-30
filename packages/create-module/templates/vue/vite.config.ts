import { moduleConfig } from "@tavora/pack/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// A module ships as one self-contained folder: relative paths, nothing loaded from the internet.
// Extra pages (an overlay, say) go in `pages`; licences to ship go in `notices`.
export default defineConfig(moduleConfig({ plugins: [vue()] }));
