// Inter for module pages, embedded in the main bundle (esbuild's base64
// loader), so modules get Tavora's font without loading anything.
import latin from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2";
import latinExt from "@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2";
import type { ModuleFonts } from "./module-style";

export const MODULE_FONTS: ModuleFonts = {
  latin: `data:font/woff2;base64,${latin}`,
  latinExt: `data:font/woff2;base64,${latinExt}`,
};
