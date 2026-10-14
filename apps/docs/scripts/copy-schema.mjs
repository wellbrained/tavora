// Publishes the manifest JSON Schema with the site, so manifests can point
// "$schema" at a URL instead of into node_modules.
import { copyFileSync, mkdirSync } from "node:fs";

const source = new URL("../../../packages/module-schema/schema/tavora.module.schema.json", import.meta.url);
const target = new URL("../public/schema/", import.meta.url);

mkdirSync(target, { recursive: true });
copyFileSync(source, new URL("tavora.module.schema.json", target));
