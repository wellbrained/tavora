// The packaged app lives in app.asar. A few files are kept next to it, in app.asar.unpacked (package.json's asarUnpack):
// the system-info worker thread and koffi with its native package (@koromix/koffi-win32-x64), which it loads.

/** Where a file of the app is on disk: in app.asar.unpacked when the path points into app.asar, else unchanged (development). */
export function unpackedPath(file: string): string {
  return file.replace(/([\\/])app\.asar(?=[\\/])/, "$1app.asar.unpacked");
}
