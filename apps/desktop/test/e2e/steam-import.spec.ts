// Import from Steam (Settings > Workspaces): what the dialog says when the link is wrong, the profile is
// private, Steam or Tavora's service can't be reached, or the account has no games. The service is a
// pretend one that answers each lookup the way the real one words it (apps/api/src/steam.ts).
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { launch } from "./harness";

type Answer = { status: number; body: unknown } | "drop";

test("a user who can't import from Steam is told what happened and what to do", async () => {
  let answer: Answer = { status: 400, body: { error: "Enter a steamcommunity.com profile link." } };
  const server = createServer((request, response) => {
    request.resume();
    if (answer === "drop") return void request.socket.destroy();
    response.writeHead(answer.status, { "content-type": "application/json" });
    response.end(JSON.stringify(answer.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const { app, page } = await launch(undefined, [], { env: { TAVORA_API_URL: url } });
  const lookUp = async (link: string) => {
    await page.getByTestId("steam-profile").fill(link);
    await page.getByTestId("steam-lookup").click();
  };
  try {
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-workspaces").click();
    await page.getByTestId("open-steam-import-settings").click();
    const error = page.getByTestId("steam-import-error");

    // A link that isn't a Steam profile: the service says what to enter, and the form stays to fix it.
    await lookUp("not a link");
    await expect(error).toHaveText("Enter a steamcommunity.com profile link.");

    // A private profile says where to change it.
    answer = { status: 502, body: { error: "Steam did not return a game list. Check that Game details are public on the profile.", reason: "no-game-list" } };
    await lookUp("https://steamcommunity.com/id/someone");
    await expect(error).toContainText("Set Game details on your Steam profile to Public");

    // Too many tries.
    answer = { status: 429, body: { error: "Too many requests." } };
    await lookUp("https://steamcommunity.com/id/someone");
    await expect(error).toHaveText("Too many tries. Please wait a minute and try again.");

    // Tavora's service can't be reached, or answers something unreadable.
    answer = "drop";
    await lookUp("https://steamcommunity.com/id/someone");
    await expect(error).toHaveText("Can't reach Tavora's service. Check your connection and try again.");
    answer = { status: 502, body: "<html>Bad gateway</html>" };
    await lookUp("https://steamcommunity.com/id/someone");
    await expect(error).toHaveText("Steam import isn't working right now. Try again in a bit.");

    // The same form works again once the service answers: an account without games says how to fix that,
    // and offers only Back (there is nothing to import).
    answer = { status: 200, body: { games: [] } };
    await lookUp("https://steamcommunity.com/id/someone");
    await expect(page.getByTestId("steam-import-empty")).toContainText("Check that your Game details are public");
    await expect(page.getByTestId("steam-import-submit")).toHaveCount(0);
    await expect(page.getByTestId("steam-share-only")).toHaveCount(0);
    await page.getByTestId("steam-back").click();
    await expect(page.getByTestId("steam-profile")).toBeVisible();

    answer = { status: 200, body: { games: [{ appid: 1, name: "Game One", id: null }] } };
    await page.getByTestId("steam-lookup").click();
    await expect(page.getByTestId("steam-game-1")).toBeVisible();
    await expect(page.getByTestId("steam-import-submit")).toBeEnabled();
  } finally {
    await app.close();
    server.close();
  }
});
