import { ref } from "vue";

/** The last thing that went wrong in an action; the page shows it at the top until the next action works. */
export const problem = ref("");
