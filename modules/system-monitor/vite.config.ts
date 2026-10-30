import tailwindcss from "@tailwindcss/vite";
import { moduleConfig } from "@tavora/pack/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// Loaded from disk, never over a network, so one bundle is fine.
export default defineConfig(moduleConfig({ plugins: [vue(), tailwindcss()], chunkSizeWarningLimit: 1500 }));
