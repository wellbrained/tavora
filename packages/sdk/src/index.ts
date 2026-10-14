// Proposed contract from the project kit (docs/15). Not a stable API.
// The host enforces every check; this package only marshals typed calls.

export interface TavoraGame {
  id: string;
  displayName: string;
}

export interface TavoraViewport {
  width: number;
  height: number;
}

export interface TavoraSDK {
  game: {
    getCurrent(): Promise<TavoraGame>;
  };
  storage: {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
  };
  workspace: {
    getViewport(): Promise<TavoraViewport>;
    onResize(fn: (viewport: TavoraViewport) => void): () => void;
  };
}
