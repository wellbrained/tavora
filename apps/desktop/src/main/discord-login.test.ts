import { describe, expect, it } from "vitest";
import { discordLogin, DISCORD_LOGIN_REDIRECT } from "./discord-login";

// Each test uses its own port, so a slow close never collides with the next.
let nextPort = 53700;

/** Runs the sign-in with a pretend browser that calls the return address with what `answer` makes of Discord's page. */
async function run(answer: (authorize: URL, port: number) => string | null) {
  const port = nextPort++;
  let opened: URL | null = null;
  const result = discordLogin({
    language: () => "en",
    port,
    timeoutMs: 2000,
    open: async (url) => {
      opened = new URL(url);
      const back = answer(opened, port);
      if (back) setTimeout(() => void fetch(back).catch(() => undefined), 10);
    },
  });
  return { result, opened: () => opened! };
}

describe("Discord browser sign-in", () => {
  it("asks for identify only with PKCE, and returns the code with the verifier", async () => {
    const { result, opened } = await run((url, port) => `http://127.0.0.1:${port}/discord?code=codenik00000&state=${url.searchParams.get("state")}`);
    const { code, verifier } = await result;
    const url = opened();
    expect(code).toBe("codenik00000");
    expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "1560388687370387610", response_type: "code", scope: "identify", redirect_uri: DISCORD_LOGIN_REDIRECT, code_challenge_method: "S256" });
    const { createHash } = await import("node:crypto");
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  it("ignores a return without its own state and gives up after the time", async () => {
    const { result } = await run((_url, port) => `http://127.0.0.1:${port}/discord?code=codeother000&state=someoneelse`);
    await expect(result).rejects.toMatchObject({ key: "account.error.discordCancelled" });
  });

  it("says cancelled when the player declines on Discord", async () => {
    const { result } = await run((url, port) => `http://127.0.0.1:${port}/discord?error=access_denied&state=${url.searchParams.get("state")}`);
    await expect(result).rejects.toMatchObject({ key: "account.error.discordCancelled" });
  });

  it("takes a second sign-in on the same port right after the first, through the same keep-alive client", async () => {
    // A browser keeps connections open; the second return must reach the second listener, not the stopped first one.
    const port = nextPort++;
    const signIn = () =>
      discordLogin({
        language: () => "en",
        port,
        timeoutMs: 2000,
        open: async (url) => {
          const state = new URL(url).searchParams.get("state");
          setTimeout(() => void fetch(`http://127.0.0.1:${port}/discord?code=codenik00000&state=${state}`, { keepalive: true }).catch(() => undefined), 10);
        },
      });
    await expect(signIn()).resolves.toMatchObject({ code: "codenik00000" });
    await expect(signIn()).resolves.toMatchObject({ code: "codenik00000" });
  });

  it("says so when the port is in use", async () => {
    const { createServer } = await import("node:net");
    const port = nextPort++;
    const blocker = createServer().listen(port, "127.0.0.1");
    await new Promise((resolve) => blocker.once("listening", resolve));
    await expect(discordLogin({ language: () => "de", port, timeoutMs: 2000, open: async () => undefined })).rejects.toMatchObject({ key: "account.error.discordPort", params: { port } });
    blocker.close();
  });
});