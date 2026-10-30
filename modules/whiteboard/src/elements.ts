// The one place that changes an Excalidraw element from outside Excalidraw. Excalidraw tells elements apart by their
// version, so a change made here has to raise it (and give a fresh nonce), or the board and its Undo history miss it.

const nonce = () => Math.floor(Math.random() * 2 ** 31);

/** The element with `patch` applied and its version raised by `steps` (two for a delete, so a restore can follow it). */
export function revised<T extends { version: number }>(element: T, patch: Partial<T> & Record<string, unknown> = {}, steps = 1): T {
  return { ...element, ...patch, version: element.version + steps, versionNonce: nonce(), updated: Date.now() };
}
