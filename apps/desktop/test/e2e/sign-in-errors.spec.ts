// Sign-in problems show in the form, next to the address the user typed, not as a toast at the top.
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { launch } from "./harness";

test("sign-in errors show under the email field, offline and when the service fails", async () => {
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Internal error." }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const sendCode = async (page: import("@playwright/test").Page) => {
    await page.getByTestId("rail-profile").click();
    await page.getByTestId("profile-nav-account").click();
    await page.getByTestId("account-email").fill("user@example.com");
    await page.getByTestId("account-send-code").click();
  };

  const failing = await launch(undefined, [], { env: { TAVORA_API_URL: `http://127.0.0.1:${port}` } });
  try {
    await sendCode(failing.page);
    await expect(failing.page.getByTestId("account-error")).toHaveText("Accounts aren't working right now. Try again in a bit.");
    await expect(failing.page.getByTestId("toast")).toHaveCount(0);
  } finally {
    await failing.app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // The same address with nothing listening: no connection at all.
  const offline = await launch(undefined, [], { env: { TAVORA_API_URL: `http://127.0.0.1:${port}` } });
  try {
    await sendCode(offline.page);
    await expect(offline.page.getByTestId("account-error")).toHaveText("Can't reach Tavora's service. Check your connection and try again.");
  } finally {
    await offline.app.close();
  }
});
