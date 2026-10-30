import { moduleConfig } from "@tavora/pack/vite";
import { defineConfig } from "vite";

// Two pages: index.html serves the Overview and Inventory panel types,
// planner.html the Build planner (see tavora.module.json).
export default defineConfig(moduleConfig({ pages: ["index", "planner"] }));
