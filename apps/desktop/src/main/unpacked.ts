// The packaged app lives in app.asar. A few files are kept next to it, in app.asar.unpacked (package.json's asarUnpack):
// the system-info worker thread and koffi's native file, which a worker can't load from inside the archive.

/** Where a file of the app is on disk: in app.asar.unpacked when the path points into app.asar, else unchanged (development). */
export function unpackedPath(file: string): string {
  return file.replace(/([\\/])app\.asar(?=[\\/])/, "$1app.asar.unpacked");
}
