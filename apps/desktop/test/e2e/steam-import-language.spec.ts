// Import from Steam (Settings > Workspaces): the service names why a lookup failed with a reason code,
// and the app words it in the user's language, English or German. A service without codes (an older one)
// keeps showing its own English text. The service here is a pretend one.
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { launch } from "./harness";

type Answer = { status: number; body: unknown };

for (const [locale, texts] of [
  ["en", ["Steam can't find that profile. Check the link and try again.", "Can't see your games. Set Game details on your Steam profile to Public and try again.", "Can't import from Steam right now. Try again in a bit."]],
  ["de", ["Steam findet dieses Profil nicht. Prüf den Link und versuch es noch mal.", "Deine Spiele sind nicht sichtbar. Stell die Spieldetails in deinem Steam-Profil auf Öffentlich und versuch es noch mal.", "Der Steam-Import klappt gerade nicht. Versuch es gleich noch mal."]],
] as const) {
  test(`the Steam import says why it failed in ${locale}`, async () => {
    let answer: Answer = { status: 404, body: { error: "Steam has no profile with that name.", code: "no-such-profile" } };
    const server = createServer((request, response) => {
      request.resume();
      response.writeHead(answer.status, { "content-type": "application/json" });
      response.end(JSON.stringify(answer.body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const { app, page } = await launch(undefined, [], { locale, env: { TAVORA_API_URL: url } });
    const lookUp = async () => {
      await page.getByTestId("steam-profile").fill("https://steamcommunity.com/id/someone");
      await page.getByTestId("steam-lookup").click();
    };
    try {
      await page.getByTestId("rail-settings").click();
      await page.getByTestId("settings-nav-workspaces").click();
      await page.getByTestId("open-steam-import-settings").click();
      const error = page.getByTestId("steam-import-error");

      await lookUp();
      await expect(error).toHaveText(texts[0]);

      answer = { status: 502, body: { error: "Steam did not return a game list. Check that Game details are public on the profile.", code: "no-game-list" } };
      await lookUp();
      await expect(error).toHaveText(texts[1]);

      // A reason this app does not know yet: the general line, never the service's English.
      answer = { status: 502, body: { error: "Something new went wrong.", code: "made-up-later" } };
      await lookUp();
      await expect(error).toHaveText(texts[2]);

      // A service without codes keeps its own text.
      answer = { status: 400, body: { error: "Enter a steamcommunity.com profile link." } };
      await lookUp();
      await expect(error).toHaveText("Enter a steamcommunity.com profile link.");
    } finally {
      await app.close();
      server.close();
    }
  });
}
