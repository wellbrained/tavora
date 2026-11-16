// Cuts Allo (allo-font on npm, SIL OFL 1.1) down to what Tavora bundles of every interface font: a Latin and a
// Latin Extended file, split like Fontsource's, as woff2 with the weight axis. Roundness is set to 0 and the optical size
// to 14 (text, which is what Tavora shows): about 80 KB instead of 180. Run it after updating allo-font, and commit what it writes:
//   node scripts/subset-allo.mjs
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";

const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.dirname(require.resolve("allo-font/package.json"));
const out = path.join(root, "..", "apps", "desktop", "src", "fonts", "allo");

// The same ranges as Fontsource's latin and latin-ext files (module-fonts.ts and fonts.css use them too).
const RANGES = {
  latin: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  "latin-ext":
    "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
};

/** Every character in a CSS unicode-range, as a string. */
function characters(range) {
  let text = "";
  for (const part of range.split(",")) {
    const [from, to = from] = part.replace("U+", "").split("-");
    for (let code = parseInt(from, 16); code <= parseInt(to, 16); code++) text += String.fromCodePoint(code);
  }
  return text;
}

const source = await readFile(path.join(pkg, "fonts", "webfonts", "AlloVariable.woff2"));
await mkdir(out, { recursive: true });
for (const [name, range] of Object.entries(RANGES)) {
  const font = await subsetFont(source, characters(range), { targetFormat: "woff2", variationAxes: { ROND: 0, opsz: 14 } });
  const file = path.join(out, `allo-${name}-wght-normal.woff2`);
  await writeFile(file, font);
  console.log(`${path.relative(process.cwd(), file)}: ${Math.round(font.length / 1024)} KB`);
}
await copyFile(path.join(pkg, "OFL.txt"), path.join(out, "OFL.txt"));
