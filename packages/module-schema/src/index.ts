// Manifest v0 for tavora.module.json. Draft from the project kit (docs/15).

export interface ModuleViewport {
  minWidth: number;
  minHeight: number;
  preferredWidth?: number;
  preferredHeight?: number;
}

export interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: "1";
  entry: string;
  games: string[];
  viewport: ModuleViewport;
  permissions: {
    network: string[];
  };
}
