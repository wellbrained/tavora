// The connected SDK for the examples that call Tavora (the shared tooltip): App.vue provides it once connected.
import type { TavoraSDK } from "@tavora/sdk";
import { inject, shallowRef, type InjectionKey, type ShallowRef } from "vue";

export const SDK: InjectionKey<ShallowRef<TavoraSDK | null>> = Symbol("tavora-sdk");
/** The SDK, or null outside Tavora and until the panel is connected. */
export const useSdk = (): ShallowRef<TavoraSDK | null> => inject(SDK, shallowRef(null));
