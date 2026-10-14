import type { TavoraHostApi } from "../shared/host-api";

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent;
  export default component;
}

declare global {
  interface Window {
    tavoraHost: TavoraHostApi;
  }
}
