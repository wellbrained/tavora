// esbuild bundles fonts as base64 strings (scripts/build.mjs).
declare module "*.woff2" {
  const base64: string;
  export default base64;
}
