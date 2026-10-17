# @tavora/module-schema

The rules for `tavora.module.json`, the manifest every [Tavora](https://mytavora.app) module has: a validator (the same one Tavora runs when it installs a module) and a JSON Schema for editors.

```ts
import { validateManifest } from "@tavora/module-schema";

const result = validateManifest(JSON.parse(text));
if (!result.ok) console.error(result.errors);
```

For completion and errors in your editor, point the manifest at the schema:

```json
{
  "$schema": "https://docs.mytavora.app/schema/tavora.module.schema.json"
}
```

What each field means is in the [manifest reference](https://docs.mytavora.app/reference/manifest). You rarely need this package directly: `@tavora/pack` checks the manifest before it packs a module.
