// electron-builder afterPack hook: makes the packaged Windows app smaller (win-unpacked, so the installer and the zip).
//  - dxcompiler.dll / dxil.dll (26 MB) are the DirectX shader compiler that only Chromium's WebGPU uses. Tavora
//    has no WebGPU; WebGL keeps working through ANGLE and d3dcompiler_47.dll, which stay.
//  - LICENSES.chromium.html (19.5 MB) is shipped as LICENSES.chromium.html.gz, next to LICENSE.electron.txt.
//    Nothing in the app reads it; it is there to satisfy the licence terms.
// A file that is not there fails the build: a new Electron may have renamed it, and the app would quietly ship full size.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const REMOVE = ["dxcompiler.dll", "dxil.dll"];
const LICENCES = "LICENSES.chromium.html";

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const dir = context.appOutDir;
  for (const name of REMOVE) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) throw new Error(`after-pack: ${name} is not in ${dir}. Did Electron rename it? Update scripts/after-pack.cjs.`);
    const size = fs.statSync(file).size;
    fs.rmSync(file);
    console.log(`  • after-pack  removed ${name} (${(size / 1048576).toFixed(1)} MB)`);
  }
  const licences = path.join(dir, LICENCES);
  if (!fs.existsSync(licences)) throw new Error(`after-pack: ${LICENCES} is not in ${dir}. Did Electron rename it? Update scripts/after-pack.cjs.`);
  const raw = fs.readFileSync(licences);
  const packed = zlib.gzipSync(raw, { level: 9 });
  fs.writeFileSync(`${licences}.gz`, packed);
  fs.rmSync(licences);
  console.log(`  • after-pack  compressed ${LICENCES} (${(raw.length / 1048576).toFixed(1)} MB -> ${(packed.length / 1048576).toFixed(1)} MB)`);
};
