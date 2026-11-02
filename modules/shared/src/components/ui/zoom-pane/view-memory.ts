// A pane's remembered view: the point in the middle and the zoom, kept in the module's own storage under the pane's
// `persistKey`, so the map opens where it was left. Writes wait until the view has been still for a moment. Nothing
// here ever throws: if storage fails, the pane simply opens on the whole content.

/** What the pane needs of the SDK's module storage (`sdk.storage`). */
export interface ViewStore {
  get(key: string): Promise<unknown>
  set(key: string, value: SavedView): Promise<unknown>
}

/** The content point in the middle of the pane (content pixels) and the zoom. A type, not an interface, so it counts as JSON. */
export type SavedView = { x: number, y: number, zoom: number }

/** How long the view must be still before it is written. */
export const SAVE_DELAY_MS = 500

let shared: ViewStore | undefined
/** Where panes keep their views. `connectModule` sets it to the module's storage. */
export function setViewMemoryStore(store: ViewStore | undefined): void {
  shared = store
}

const open = new Set<ViewMemory>()
/** Writes every view that is waiting. Call it from `onSuspend` and `onDispose`, as for any pending save. */
export async function flushViewMemory(): Promise<void> {
  await Promise.all([...open].map((memory) => memory.flush()))
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

/** A stored value read back; null if it is not a view (old data, another shape). */
export function readSavedView(value: unknown): SavedView | null {
  if (typeof value !== "object" || value === null) return null
  const { x, y, zoom } = value as Record<string, unknown>
  return finite(x) && finite(y) && finite(zoom) && zoom > 0 ? { x, y, zoom } : null
}

export interface ViewMemory {
  /** The saved view, or null if there is none (or no storage). */
  load(): Promise<SavedView | null>
  /** Keeps `view` to be written once the view has been still for `SAVE_DELAY_MS`. */
  save(view: SavedView): void
  /** Writes a waiting view now. */
  flush(): Promise<void>
}

export function createViewMemory(persistKey: string, options: { store?: ViewStore, delay?: number } = {}): ViewMemory {
  const key = `zoom-view:${persistKey}`
  const delay = options.delay ?? SAVE_DELAY_MS
  let waiting: SavedView | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const store = () => options.store ?? shared

  const memory: ViewMemory = {
    async load() {
      try {
        return readSavedView(await store()?.get(key))
      }
      catch {
        return null
      }
    },
    save(view) {
      waiting = { ...view }
      open.add(memory)
      clearTimeout(timer)
      timer = setTimeout(() => void memory.flush(), delay)
    },
    async flush() {
      clearTimeout(timer)
      timer = undefined
      const view = waiting
      waiting = null
      open.delete(memory)
      if (!view) return
      try {
        await store()?.set(key, view)
      }
      catch {}
    },
  }
  return memory
}
