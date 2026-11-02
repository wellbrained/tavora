// Every example file, loaded twice: as the component the page shows, and as its own text for "Show code". Both come
// from the same file, so the code shown is always the code that runs.
import type { Component } from "vue";

const components = import.meta.glob<Component>("./examples/**/*.vue", { eager: true, import: "default" });
const sources = import.meta.glob<string>("./examples/**/*.vue", { eager: true, query: "?raw", import: "default" });

export function loadExample(file: string): { component: Component; source: string } | undefined {
  const path = `./examples/${file}.vue`;
  const component = components[path];
  const source = sources[path];
  return component && source !== undefined ? { component, source } : undefined;
}
