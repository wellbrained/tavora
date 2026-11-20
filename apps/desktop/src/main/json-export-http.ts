// files.exportJson, the older way to save JSON (deprecated for files.saveJson). It used to write into Downloads\Tavora
// without asking; now it saves like every other file (CLAUDE.md, "Save and open files"): Tavora's save dialog with the
// name filled in, opening where the user last saved or opened a file of that module. Only the answer differs from
// files.saveJson: the SDK promises a file name, so a closed dialog is refused (PERMISSION_DENIED) instead of null.
import { HostError } from "./errors";
import { serveJsonSave, type JsonSaveDeps } from "./json-file-http";

/** The name the SDK suggests when the module gives none. */
const DEFAULT_NAME = "Build";

export async function serveJsonExport(request: Request, url: URL, deps: JsonSaveDeps, clean: (name: string) => string): Promise<Response> {
  const save: JsonSaveDeps["save"] = async (data, name) => {
    const fileName = await deps.save(data, name);
    if (fileName === null) throw new HostError("PERMISSION_DENIED", "the save dialog was closed");
    return fileName;
  };
  return serveJsonSave(request, url, { ...deps, save }, (name) => clean(name.trim() || DEFAULT_NAME));
}
