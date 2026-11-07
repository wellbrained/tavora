# Testing a panel in the browser

[Testing your module](./testing) covers your code with the memory host. This page goes one step further: your module's **real panel** runs in a real browser, on the memory host instead of Tavora, and checks look at what it draws. Nothing starts Tavora or a game.

Everything here comes from `@tavora/sdk/testing` (SDK 0.3.14 or newer). The SDK needs no test runner, framework or browser driver: use Vitest, Playwright, Puppeteer or whatever you have.

## Install

You need a test runner and a way to drive a browser. With Vitest and Playwright, using the Chrome or Edge you already have:

::: code-group

```sh [pnpm]
pnpm add -D vitest playwright-core
```

```sh [npm]
npm install -D vitest playwright-core
```

```sh [Yarn]
yarn add -D vitest playwright-core
```

```sh [Bun]
bun add -d vitest playwright-core
```

:::

`playwright-core` starts the system's browser (`chromium.launch({ channel: "chrome" })`). Install `playwright` instead if you'd rather have it download one.

## Start your panel

`mountPanel` runs your panel's page code the way Tavora loads it, and waits until it has connected. Pass `start`, which does what your entry file does, and return how to take it down:

```ts
import { createApp } from "vue";
import { mountPanel } from "@tavora/sdk/testing";
import App from "../src/App.vue";
import "../src/style.css";

const panel = await mountPanel({
  language: "de",
  start: (container) => {
    const app = createApp(App);
    app.mount(container);
    return () => app.unmount();
  },
});
```

Your page keeps calling `connect()`, `bootstrapModule()` or the kit's `connectModule()` as it does in Tavora; while `mountPanel` starts it, that call gets this panel's memory host. You don't change your module's code for the test.

`panel.host` is the memory host's control side, as in [Testing your module](./testing): `panel.host.storage`, `panel.host.emit(...)`, `panel.host.answer(...)`, `panel.host.calls`. `mountPanel` takes every option of `createMemoryHost`, with two defaults that match Tavora rather than a unit test:

- **Calls that need a click are refused without one** (`gestures: "enforce"`). A real press in the panel (a mouse button, a touch, a key) lets one such call through, as in Tavora. A press in a dialog or menu drawn at the end of the page counts for the panel you pressed last. A scripted `element.click()` is no press; use your driver's click, or `panel.host.gesture()`.
- **The theme is Tavora Dark.**

By default the panel draws into a new element as tall as the window. Pass `container` to put it somewhere else, for example two panels side by side.

### Close, reopen, a second panel

`await panel.unmount()` closes the panel as Tavora does: `lifecycle.onDispose` fires, then your page is taken down. What it saved stays. To open it again, or to open a second panel of the same module, pass the first panel's host:

```ts
await panel.unmount();
const again = await mountPanel({ share: panel.host, start });
```

Panels start one at a time, so each gets its own host even if you start several at once.

## Themes

Check every panel in a dark and a light theme. `themeOf("dark")` is Tavora Dark and `themeOf("light")` is Hearthwood Light, exactly as a panel gets them from Tavora:

```ts
import { themeOf } from "@tavora/sdk/testing";

panel.host.changeTheme(themeOf("light"));
panel.host.setLanguage("de");
```

For your own theme, `themeFromPackage(json, "light")` turns a `tavora.theme.json` into the theme Tavora would send, filling in the colours a theme may leave out. The second argument is a variation's id, or `"dark"` or `"light"`.

## Check the layout

`inspectLayout(root)` looks at everything visible in the panel and lists what's wrong:

| Kind | What it found |
|---|---|
| `overflow` | Something sticks out of the panel, and nothing around it clips or scrolls it. |
| `page-overflow` | The page is wider than the window, so it scrolls sideways. |
| `clipped` | Text cut off without an ellipsis, an ellipsis with no title to read the whole text, or an input value cut off by its field. |
| `small-text` | Text under 12 px. |

Each finding is `{ kind, where, detail }`. `where` names the element by tag, then `data-testid`, `aria-label` or `title`, then its first words, so give your controls test ids and the report reads well.

The kit's dialogs (`[data-slot=dialog-content]`) may stick out of the panel. Change that with `outside`, leave parts out with `skip`, or set another smallest size with `minFontSize`.

The checks need a browser that lays the page out. In jsdom they find nothing.

## Check the Tab key

`checkFocus(page, root)` presses Tab through the panel and checks that:

- every visible control can be reached (a radio group or tab list is one stop),
- the order follows reading order: top to bottom, left to right within a row,
- no control has a `tabindex` above 0,
- every stop shows a focus ring.

It resolves with `{ stops, issues, complete }`: the stops in order, the findings (`unreachable`, `focus-order`, `positive-tabindex`, `focus-ring`) and whether Tab went all the way round. If a dialog is open, it starts there.

By default a control that matches `:focus-visible` counts as having a ring, so a ring your CSS takes away goes unseen. Pass `strictRing: true` to count only a drawn outline or shadow.

## Put it together

Two common setups. Both use the same checks.

### Vitest browser mode

The test runs in the page, next to your panel. `inspectLayout` runs there as it is; `inspectFocus` needs a real Tab press from the runner:

```ts
import { userEvent } from "vitest/browser";
import { inspectFocus, inspectLayout, mountPanel } from "@tavora/sdk/testing";

it("draws the start screen cleanly", async () => {
  const panel = await mountPanel({ start });
  panel.container.id = "panel";
  panel.container.style.width = "360px";
  panel.container.style.height = "640px";

  expect(inspectLayout("#panel")).toEqual([]);
  expect((await inspectFocus("#panel", { pressTab: () => userEvent.tab() })).issues).toEqual([]);
  await panel.unmount();
});
```

### A page and Playwright

Serve a small page with your bundler's dev server whose script mounts the panel:

```ts
// test/panel-page.ts
import { mountPanel } from "@tavora/sdk/testing";

const panel = await mountPanel({ container: document.getElementById("panel")!, start });
(window as { panel?: typeof panel }).panel = panel;
```

Then drive it from Node. `checkLayout` and `checkFocus` take any page with `evaluate` and `keyboard.press`, so a Playwright or Puppeteer page works as it is:

```ts
import { chromium } from "playwright-core";
import { checkFocus, checkLayout } from "@tavora/sdk/testing";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
await page.goto("http://localhost:5173/test/panel.html");
await page.waitForFunction(() => "panel" in window);

expect(await checkLayout(page, "#panel")).toEqual([]);
expect((await checkFocus(page, "#panel")).issues).toEqual([]);
```

To reach the panel's host from the test, run code in the page: `page.evaluate(() => window.panel.host.storage.entries())`.

Take a screenshot with your driver (`page.screenshot()`) at each size, theme and language you care about, and look through them: the checks catch what can be measured, not whether it looks right.

## What it can't check

The game and its overlay, Tavora's own dialogs and permission prompts, hotkeys, and anything that takes judgement. Look at those in Tavora.
