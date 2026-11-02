// Every example file, as a component to show and as its source for Show code. Both come from the same file, so the
// code shown is always the code running.
import type { Component } from "vue";
import { shownSource } from "./shown-source";

const components = import.meta.glob<Component>("./examples/*/*.vue", { eager: true, import: "default" });
const sources = import.meta.glob<string>("./examples/*/*.vue", { eager: true, query: "?raw", import: "default" });

export interface Example {
  /** Where it lives, such as "buttons/Variants.vue". */
  file: string;
  component: Component;
  source: string;
}

const path = (page: string, name: string) => `./examples/${page}/${name}.vue`;

export function exampleFor(page: string, name: string): Example | undefined {
  const component = components[path(page, name)];
  const source = sources[path(page, name)];
  if (!component || source === undefined) return undefined;
  return { file: `${page}/${name}.vue`, component, source: shownSource(source) };
}
