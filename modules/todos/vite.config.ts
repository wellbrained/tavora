import tailwindcss from "@tailwindcss/vite";
import { moduleConfig } from "@tavora/pack/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// Two pages: the panel, and the live view Tavora shows over the game, which it serves next to it.
// Loaded from disk, never over a network, so one bundle is fine.
export default defineConfig(moduleConfig({ pages: ["index", "overlay"], plugins: [vue(), tailwindcss()], chunkSizeWarningLimit: 1500 }));
