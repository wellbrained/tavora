import { onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from "vue";

/** Loads faster than this show no placeholder at all, so a quick load never flashes. */
export const SKELETON_DELAY = 150;
/** How long the content takes to arrive over the placeholder (--duration-reveal). */
export const SKELETON_REVEAL = 200;

/**
 * Where a placeholder is:
 * - `idle`: nothing is loading; the content is shown as it is.
 * - `waiting`: loading just started; the placeholder content is laid out but not shown yet.
 * - `on`: still loading after the delay; the placeholder is shown.
 * - `leaving`: loaded after the placeholder was shown; the content fades in over it.
 */
export type SkeletonState = "idle" | "waiting" | "on" | "leaving";

/** The state of a placeholder for something that loads (see Skeleton.vue). Done in a component's setup. */
export function useSkeleton(loading: MaybeRefOrGetter<boolean>, delay: MaybeRefOrGetter<number> = SKELETON_DELAY): Readonly<Ref<SkeletonState>> {
  const state = ref<SkeletonState>(toValue(loading) ? "waiting" : "idle");
  let timer: ReturnType<typeof setTimeout> | undefined;

  function start() {
    clearTimeout(timer);
    state.value = "waiting";
    timer = setTimeout(() => (state.value = "on"), toValue(delay));
  }
  function stop() {
    clearTimeout(timer);
    // Never shown: the content is simply there. Shown: it arrives over the placeholder.
    if (state.value === "on") {
      state.value = "leaving";
      timer = setTimeout(() => (state.value = "idle"), SKELETON_REVEAL);
    } else {
      state.value = "idle";
    }
  }

  if (state.value === "waiting") start();
  watch(
    () => toValue(loading),
    (now) => (now ? start() : stop()),
  );
  onScopeDispose(() => clearTimeout(timer));
  return state;
}

/**
 * A made-up text of about `length` characters for placeholder data. Its words wrap like real ones, which is all that
 * matters: the text itself is never seen. Give each placeholder the length its real text usually has.
 */
export function placeholderText(length: number): string {
  const words = ["lorem", "ipsum", "dolor", "sit", "amet", "magna", "elit", "sed", "do", "tempor"];
  let text = "";
  for (let i = 0; text.length < length; i++) text += (text ? " " : "") + words[i % words.length];
  return text.slice(0, Math.max(1, length)).trimEnd() || "x";
}
