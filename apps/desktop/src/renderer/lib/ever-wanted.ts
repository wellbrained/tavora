import { ref, watch, type Ref, type WatchSource } from "vue";

/**
 * False until `source` first holds something, then true for good. A rarely used dialog that is always in the
 * page (it keeps its own state and closing animation) is drawn only from this on, so its code loads the first
 * time it is wanted and the dialog stays where it was after that.
 */
export function everWanted(source: WatchSource<unknown>): Ref<boolean> {
  const wanted = ref(false);
  watch(
    source,
    (value) => {
      if (value) wanted.value = true;
    },
    { immediate: true },
  );
  return wanted;
}
