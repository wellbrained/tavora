import type { TavoraHostApi } from "../shared/host-api";
import type { TavoraToastsApi } from "../shared/host-toasts";

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent;
  export default component;
}

declare global {
  interface Window {
    tavoraHost: TavoraHostApi;
    /** Only on the toast page (toasts.html). */
    tavoraToasts: TavoraToastsApi;
  }
}
