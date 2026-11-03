// electron-builder afterPack hook: makes the packaged app smaller (win-unpacked, so the installer and the zip).
//  - dxcompiler.dll / dxil.dll (26 MB) are the DirectX shader compiler that only Chromium's WebGPU uses. Tavora
//    has no WebGPU; WebGL keeps working through ANGLE and d3dcompiler_47.dll, which stay.
//  - LICENSES.chromium.html (19.5 MB) is shipped as LICENSES.chromium.html.gz, next to LICENSE.electron.txt.
//    Nothing in the app reads it; it is there to satisfy the licence terms.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const REMOVE = ["dxcompiler.dll", "dxil.dll"];

exports.default = async function afterPack(context) {
  const dir = context.appOutDir;
  for (const name of REMOVE) fs.rmSync(path.join(dir, name), { force: true });
  const licences = path.join(dir, "LICENSES.chromium.html");
  if (fs.existsSync(licences)) {
    fs.writeFileSync(`${licences}.gz`, zlib.gzipSync(fs.readFileSync(licences), { level: 9 }));
    fs.rmSync(licences);
  }
};
