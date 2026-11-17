/** Whether this page runs on a Mac (Cmd instead of Ctrl, "Cmd" instead of "Win" on key caps). One answer for the kit and the app. */
export const isMac = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac")
