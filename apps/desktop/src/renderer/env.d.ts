import type { TavoraHostApi } from "../shared/host-api";
import type { TavoraToastsApi } from "../shared/host-toasts";
import type { TavoraLayerCardApi } from "../shared/layer-card";

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
    /** Only on the in-game layer's card (layer-card.html). */
    tavoraLayerCard: TavoraLayerCardApi;
  }
}
