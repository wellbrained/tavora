import { defineConfig, defaultClientConditions } from "vite";
import { cpSync as copy, mkdirSync as mkdir, readFileSync as read, writeFileSync as write } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const cpSync=(from:string,to:string,options?:Parameters<typeof copy>[2])=>copy(path.resolve(here,from),path.resolve(here,to),options);
const mkdirSync=(name:string,options?:Parameters<typeof mkdir>[1])=>mkdir(path.resolve(here,name),options);
const readFileSync=(name:string,_encoding:string)=>read(path.resolve(here,name),"utf8");
const writeFileSync=(name:string,value:string)=>write(path.resolve(here,name),value);
export default defineConfig({
  root: "src",
  base: "./",
  publicDir: "../public",
  resolve: { conditions: ["source", ...defaultClientConditions] },
  build: { outDir: "../dist", emptyOutDir: true, target: "chrome130" },
  plugins: [
    {
      name: "source-notices",
      closeBundle() {
        for (const name of ["LICENSE", "UPSTREAM.md"])
          cpSync(name, "dist/" + name);
        cpSync("vendor", "dist/source/vendor", { recursive: true });
        cpSync("src", "dist/source/src", { recursive: true });
        cpSync("public", "dist/source/public", { recursive: true });
        cpSync("node_modules/i18next/LICENSE", "dist/I18NEXT-LICENSE.txt");
        mkdirSync("dist/source/sdk", { recursive: true });
        cpSync("../../packages/sdk/src", "dist/source/sdk/src", {
          recursive: true,
        });
        const sdkPackage = JSON.parse(
          readFileSync("../../packages/sdk/package.json", "utf8"),
        );
        sdkPackage.exports = {
          ".": "./src/index.ts",
          "./protocol": "./src/protocol.ts",
        };
        writeFileSync(
          "dist/source/sdk/package.json",
          JSON.stringify(sdkPackage, null, 2),
        );
        cpSync("../../LICENSE", "dist/source/sdk/LICENSE");
        for (const name of ["package.json", "vite.config.ts", "tsconfig.json"])
          cpSync(name, "dist/source/" + name);
        const standalone = JSON.parse(readFileSync("package.json", "utf8"));
        standalone.dependencies["@tavora/sdk"] = "file:./sdk";
        writeFileSync(
          "dist/source/package.json",
          JSON.stringify(standalone, null, 2),
        );
        const config = JSON.parse(readFileSync("tsconfig.json", "utf8"));
        delete config.extends;
        Object.assign(config.compilerOptions, {
          module: "ESNext",
          moduleResolution: "Bundler",
          target: "ES2022",
          strict: true,
          skipLibCheck: true,
        });
        writeFileSync(
          "dist/source/tsconfig.json",
          JSON.stringify(config, null, 2),
        );
        writeFileSync(
          "dist/source/vite.config.ts",
          'import {defineConfig} from "vite";export default defineConfig({root:"src",base:"./",publicDir:"../public",build:{outDir:"../dist",emptyOutDir:true,target:"chrome130"}});\n',
        );
        writeFileSync(
          "dist/source/README.md",
          "Corresponding source: npm install, then npm run build. SDK source is supplied in sdk/. Original sources and pinned provenance are retained in the Tavora repository.\n",
        );
      },
    },
  ],
});
