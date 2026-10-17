import { DISCORD_COMMANDS, DISCORD_EVENTS, type DiscordCommand, type DiscordEventName } from "@tavora/sdk/protocol";
import { HostError } from "./errors";
import { isSnowflake } from "./discord-parse";

// What a module may send through the Discord connector. Every command has a
// fixed set of arguments; Tavora builds what goes to Discord from exactly
// those, so a module can't add fields Discord would act on.

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HostError("INVALID_PARAMS", `${name} must be an object`);
  return value as Record<string, unknown>;
}

function only(args: Record<string, unknown>, allowed: string[], command: string): void {
  const extra = Object.keys(args).filter((key) => !allowed.includes(key));
  if (extra.length > 0) throw new HostError("INVALID_PARAMS", `${command} takes no ${extra.join(", ")}`);
}

function snowflake(args: Record<string, unknown>, name: string, command: string): string {
  const value = args[name];
  if (!isSnowflake(value)) throw new HostError("INVALID_PARAMS", `${command} needs args.${name}, a Discord id`);
  return value;
}

function flag(args: Record<string, unknown>, name: string): { [key: string]: boolean } {
  if (args[name] === undefined) return {};
  if (typeof args[name] !== "boolean") throw new HostError("INVALID_PARAMS", `args.${name} must be true or false`);
  return { [name]: args[name] as boolean };
}

/** Checks a discord.command call and returns the command with the arguments Tavora will send. Throws INVALID_PARAMS. */
export function discordCommand(params: Record<string, unknown>): { command: DiscordCommand; args: Record<string, unknown> } {
  const command = params.command;
  if (typeof command !== "string" || !(DISCORD_COMMANDS as readonly string[]).includes(command)) {
    throw new HostError("INVALID_PARAMS", `params.command must be one of ${DISCORD_COMMANDS.join(", ")}`);
  }
  const name = command as DiscordCommand;
  const args = object(params.args ?? {}, "params.args");
  switch (name) {
    case "GET_SELECTED_VOICE_CHANNEL":
    case "GET_GUILDS":
      only(args, [], name);
      return { command: name, args: {} };
    case "GET_GUILD":
    case "GET_CHANNELS":
      only(args, ["guild_id"], name);
      return { command: name, args: { guild_id: snowflake(args, "guild_id", name) } };
    case "GET_CHANNEL":
      only(args, ["channel_id"], name);
      return { command: name, args: { channel_id: snowflake(args, "channel_id", name) } };
    case "SELECT_VOICE_CHANNEL":
      only(args, ["channel_id"], name);
      return { command: name, args: { channel_id: args.channel_id === null ? null : snowflake(args, "channel_id", name) } };
    case "SET_VOICE_SETTINGS": {
      only(args, ["mute", "deaf"], name);
      const settings = { ...flag(args, "mute"), ...flag(args, "deaf") };
      if (Object.keys(settings).length === 0) throw new HostError("INVALID_PARAMS", `${name} needs args.mute or args.deaf`);
      return { command: name, args: settings };
    }
    case "SET_USER_VOICE_SETTINGS": {
      only(args, ["user_id", "volume", "mute"], name);
      const volume = args.volume;
      if (volume !== undefined && (typeof volume !== "number" || !Number.isInteger(volume) || volume < 0 || volume > 200)) {
        throw new HostError("INVALID_PARAMS", "args.volume must be a whole number from 0 to 200");
      }
      const settings = { ...(volume === undefined ? {} : { volume }), ...flag(args, "mute") };
      if (Object.keys(settings).length === 0) throw new HostError("INVALID_PARAMS", `${name} needs args.volume or args.mute`);
      return { command: name, args: { user_id: snowflake(args, "user_id", name), ...settings } };
    }
  }
}

/** Checks a discord.subscribe or discord.unsubscribe call. VOICE_CHANNEL_SELECT takes no channel; the others need one. */
export function discordSubscription(params: Record<string, unknown>): { event: DiscordEventName; channelId: string | null } {
  const event = params.event;
  if (typeof event !== "string" || !(DISCORD_EVENTS as readonly string[]).includes(event)) {
    throw new HostError("INVALID_PARAMS", `params.event must be one of ${DISCORD_EVENTS.join(", ")}`);
  }
  only(params, ["event", "channelId"], "params");
  if (event === "VOICE_CHANNEL_SELECT") {
    if (params.channelId !== undefined) throw new HostError("INVALID_PARAMS", "VOICE_CHANNEL_SELECT takes no params.channelId");
    return { event, channelId: null };
  }
  if (!isSnowflake(params.channelId)) throw new HostError("INVALID_PARAMS", `${event} needs params.channelId, a Discord id`);
  return { event: event as DiscordEventName, channelId: params.channelId };
}
