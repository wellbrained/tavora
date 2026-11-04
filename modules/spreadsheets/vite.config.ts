import tailwindcss from "@tailwindcss/vite";
import { moduleConfig } from "@tavora/pack/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// Two pages: the panel, and the live view Tavora shows over the game. ExcelJS is only loaded when an xlsx is
// imported or exported, so it lands in a chunk of its own. Loaded from disk, never over a network.
export default defineConfig(moduleConfig({ pages: ["index", "overlay"], plugins: [vue(), tailwindcss()], notices: { exceljs: "exceljs" }, chunkSizeWarningLimit: 2500 }));
