// Excalidraw can turn Mermaid text into a drawing. Tavora does not offer that, and the real library is the largest
// part of Excalidraw, so the build swaps it for this: the import still resolves and the feature just reports it is off.
export async function parseMermaidToExcalidraw(): Promise<never> {
  throw new Error("Mermaid import is not part of the Tavora Whiteboard");
}
