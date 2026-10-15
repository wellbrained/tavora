/** The modules that have an icon (see ModuleIcon.vue); the others show a letter or just the name. */
const WITH_ICON = new Set(["tavora.discord", "tavora.browser", "tavora.notes", "tavora.todos"]);
export const hasModuleIcon = (moduleId: string | undefined): boolean => WITH_ICON.has(moduleId ?? "");
