import { moduleConfig } from "@tavora/pack/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(moduleConfig({ plugins: [react()] }));
