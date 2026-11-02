import { onScopeDispose, toValue, watch, type MaybeRefOrGetter } from "vue";
import { unrefElement, type MaybeComputedElementRef } from "@vueuse/core";
import { inputOrigin, trackInputOrigin } from "./input-origin";
import { createSlidingIndicator, type IndicatorAxis, type SlidingIndicator } from "./sliding-indicator";

export interface UseSlidingIndicatorOptions {
  /** Finds the active item inside the container, e.g. `:scope > [data-state="active"]`. */
  selector: string;
  /** The way the highlight moves (default "x"). */
  axis?: IndicatorAxis;
  /** false makes every change a jump (default true). A change made with the keys always jumps. */
  smooth?: MaybeRefOrGetter<boolean>;
  /** false takes the highlight away, e.g. for a strip that draws its own (default true). */
  enabled?: MaybeRefOrGetter<boolean>;
}

/**
 * Keeps a highlight under the active item of `container` (a template ref, of an element or a component). The container must be
 * `position: relative`, and hold an element with the class `tavora-indicator` that draws the highlight (motion.css
 * explains the variables and states). Slides when a click or touch changes the active item, jumps for the keyboard,
 * on first paint, after a resize or a font loading, and when the options change.
 */
export function useSlidingIndicator(container: MaybeRefOrGetter<unknown>, options: UseSlidingIndicatorOptions) {
  let current: SlidingIndicator | undefined;
  const stopTracking = trackInputOrigin();

  const stopWatching = watch(
    () => [unrefElement(container as MaybeComputedElementRef), toValue(options.enabled) ?? true] as const,
    ([element, enabled]) => {
      current?.destroy();
      current = element && enabled ? createSlidingIndicator(element, { selector: options.selector, axis: options.axis, smooth: () => (toValue(options.smooth) ?? true) && inputOrigin() === "pointer" }) : undefined;
    },
    // After the DOM is patched, so the container and its items exist and have their size.
    { flush: "post", immediate: true },
  );

  onScopeDispose(() => {
    stopWatching();
    current?.destroy();
    current = undefined;
    stopTracking();
  });

  return {
    /** Measures again now (the observers already do it for everything the browser reports). */
    update: () => current?.update(),
  };
}
