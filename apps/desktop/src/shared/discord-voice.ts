// Discord voice is paused (the owner's decision of 2026-11-14, vault AI/Decisions.md): Discord lets an app use voice
// only for 50 approved testers until it approves the app, and that needs a bigger userbase first. It is switched off,
// not deleted: setting DISCORD_VOICE_PAUSED to false brings all of it back.
//
// While paused, the connection to the Discord app never starts (main/discord.ts), Settings > Connections and its search
// leave Discord out (renderer/host.ts hiddenSettingIds), and panels of the Discord module say it's paused instead of
// loading it or offering to install it (main/host.ts panelTypeOf, PanelContent.vue). Nothing saved is changed: panels,
// settings, module data and the Discord sign-in stay as they are. Signing in to the Tavora account with Discord is a
// different thing and stays.

/** One switch for every place that hides the Discord voice connection. */
export const DISCORD_VOICE_PAUSED: boolean = true;

/** The Discord module in the catalog. */
export const DISCORD_MODULE_ID = "wellbrained.discord";

/** The Discord module, and the official one it replaced (main/moved-modules.ts moves those panels over at start). */
const DISCORD_VOICE_MODULES: readonly string[] = [DISCORD_MODULE_ID, "tavora.discord"];

/** Whether a panel of this module shows the paused note instead of running. */
export function isVoicePaused(moduleId: string, paused: boolean = DISCORD_VOICE_PAUSED): boolean {
  return paused && DISCORD_VOICE_MODULES.includes(moduleId);
}
