import { defineConfig } from "vite";
export default defineConfig({base:"./",resolve:{conditions:["source"]},publicDir:"public",build:{target:"chrome130",modulePreload:{polyfill:false}}});
