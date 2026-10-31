// Accessibility checks on the host UI: small text, off switches and dimmed buttons keep enough
// contrast in every official theme, and every button has a name a screen reader can say.
import { expect, test, type Page } from "@playwright/test";
import { inModule, launch, NOTES, openModule, openWorkspace, TODOS } from "./harness";

/** WCAG 2 contrast ratio of two sRGB colours given as [r, g, b] in 0–255. */
function contrast(a: number[], b: number[]): number {
  const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.map((channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Runs in a page: the colour an element's text and its background end up as on screen, with the
 * element's and its ancestors' opacity and any translucent backgrounds composited over what is
 * behind them. Returns [r, g, b] for both, or null when the element is missing.
 */
const PAINTED = `
  (selector, pseudo) => {
    const parse = (value) => {
      const match = value.match(/rgba?\\(([^)]+)\\)/);
      if (!match) return null;
      const parts = match[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number);
      return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
    };
    const over = (top, alpha, under) => top.map((channel, i) => Math.round(channel * alpha + under[i] * (1 - alpha)));
    const element = document.querySelector(selector);
    if (!element) return null;
    // Background: walk up until something opaque, compositing translucent layers on the way down.
    const layers = [];
    for (let node = element.parentElement; node; node = node.parentElement) {
      const background = parse(getComputedStyle(node).backgroundColor);
      if (background && background.alpha > 0) layers.push({ ...background, opacity: Number(getComputedStyle(node).opacity) });
      if (background && background.alpha >= 1) break;
    }
    let behind = [255, 255, 255];
    for (const layer of layers.reverse()) behind = over(layer.rgb, layer.alpha * layer.opacity, behind);
    const style = getComputedStyle(element, pseudo || null);
    const own = parse(style.backgroundColor);
    let opacity = Number(getComputedStyle(element).opacity);
    for (let node = element.parentElement; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    // Inside the element first (its text over its own fill), then the whole element at its opacity over what is behind it.
    const inner = own && own.alpha > 0 ? over(own.rgb, own.alpha, behind) : behind;
    const text = parse(style.color);
    const ink = over(text.rgb, text.alpha, inner);
    return { text: over(ink, opacity, behind), fill: over(inner, opacity, behind), behind, fontSize: style.fontSize };
  }
`;

type Painted = { text: number[]; fill: number[]; behind: number[]; fontSize: string } | null;

async function painted(page: Page, selector: string, pseudo?: string): Promise<Painted> {
  return page.evaluate(`(${PAINTED})(${JSON.stringify(selector)}, ${JSON.stringify(pseudo ?? "")})`) as Promise<Painted>;
}

/** Waits until nothing on the page fades or moves any more, so a dialog's fade-in does not dim what is measured. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(() => Promise.all(document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity))
        .map((animation) => animation.finished.catch(() => undefined))));
}

async function paintedInNotes(app: Parameters<typeof inModule>[0], selector: string, pseudo?: string): Promise<Painted> {
  return inModule<Painted>(app, NOTES, `(${PAINTED})(${JSON.stringify(selector)}, ${JSON.stringify(pseudo ?? "")})`);
}

const THEMES = [
  { id: "tavora.default", name: "Tavora" },
  { id: "tavora.dusk-rose", name: "Dusk Rose" },
  { id: "tavora.garnet", name: "Garnet" },
  { id: "tavora.amethyst", name: "Amethyst" },
  { id: "tavora.hearthwood", name: "Hearthwood" },
  { id: "tavora.nightfall", name: "Nightfall" },
] as const;
const MODES = ["dark", "light"] as const;

/** What each measured spot needs: 4.5:1 for text, 3:1 for a control's outline or a dimmed button. */
const NEEDS = {
  "Notes placeholder": 4.5,
  "Point at a size": 4.5,
  "Section label": 4.5,
  "Menu group label": 4.5,
  "Off switch track": 3,
  "Disabled secondary button": 3,
  "Disabled danger button": 3,
  "Disabled primary button": 3,
} as const;
type Spot = keyof typeof NEEDS;

test("small text, off switches and disabled buttons keep their contrast in every official theme", async () => {
  test.setTimeout(180_000);
  const { app, page } = await launch();
  // Satisfactory gets Notes; the layout picker's caption is read from the Layouts menu.
  await openWorkspace(page, "satisfactory");
  await openModule(page, NOTES);
  await expect.poll(() => inModule<number>(app, NOTES, `document.querySelectorAll('[data-testid="note-editor"]').length`).catch(() => 0)).toBeGreaterThan(0);

  const rows: { theme: string; mode: string; spot: Spot; ratio: number; text: string; fill: string }[] = [];
  const hex = (rgb: number[]) => `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  const record = (theme: string, mode: string, spot: Spot, sample: Painted) => {
    expect(sample, `${spot} was not found (${theme} ${mode})`).not.toBeNull();
    rows.push({ theme, mode, spot, ratio: contrast(sample!.text, sample!.fill), text: hex(sample!.text), fill: hex(sample!.fill) });
  };

  for (const theme of THEMES) {
    for (const mode of MODES) {
      await page.getByTestId("rail-settings").click();
      await page.getByTestId("settings-nav-appearance").click();
      await page.getByTestId(`theme-${theme.id}`).click();
      await page.getByTestId(`mode-${mode}`).click();
      await expect(page.getByTestId(`mode-${mode}`)).toHaveAttribute("aria-checked", "true");
      await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(mode === "dark");

      await settled(page);
      record(theme.name, mode, "Section label", await painted(page, '[data-testid="settings"] section > header h3'));
      record(theme.name, mode, "Menu group label", await painted(page, '[data-testid="settings"] nav h3, [data-testid="settings"] h3'));
      const grayscale = page.getByTestId("grayscale-text");
      if ((await grayscale.getAttribute("data-state")) === "checked") await grayscale.click();
      await expect(grayscale).toHaveAttribute("data-state", "unchecked");
      await settled(page);
      const track = await painted(page, '[data-testid="grayscale-text"]');
      record(theme.name, mode, "Off switch track", track && { ...track, text: track.fill, fill: track.behind });
      // Reset is only disabled on the default theme, so it is dimmed by hand to measure the disabled look.
      await page.getByTestId("reset-theme").evaluate((button) => ((button as HTMLButtonElement).disabled = true));
      await settled(page);
      record(theme.name, mode, "Disabled secondary button", await painted(page, '[data-testid="reset-theme"]'));
      await page.getByTestId("reset-theme").evaluate((button) => ((button as HTMLButtonElement).disabled = false));
      // "Remove" waits for a ticked workspace, and "Send code" for an email: both are disabled on a fresh profile.
      await page.getByTestId("settings-nav-games").click();
      await page.getByTestId("games-open-workspaces").click();
      await expect(page.getByTestId("workspaces-remove")).toBeDisabled();
      await settled(page);
      record(theme.name, mode, "Disabled danger button", await painted(page, '[data-testid="workspaces-remove"]'));
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("settings")).toHaveCount(0);
      // The account is in the profile dialog.
      await page.getByTestId("rail-profile").click();
      await page.getByTestId("profile-nav-account").click();
      await expect(page.getByTestId("account-send-code")).toBeDisabled();
      await settled(page);
      record(theme.name, mode, "Disabled primary button", await painted(page, '[data-testid="account-send-code"]'));
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("profile-dialog")).toHaveCount(0);

      await openWorkspace(page, "poe2");
      await settled(page);
      // The grid picker's caption now lives in the Layouts menu.
      await page.getByTestId("layouts").click();
      await expect(page.getByTestId("layout-grid-size")).toBeVisible();
      await settled(page);
      record(theme.name, mode, "Point at a size", await painted(page, '[data-testid="layout-grid-size"]'));
      await page.keyboard.press("Escape");
      await openWorkspace(page, "satisfactory");
      await expect
        .poll(() => inModule<string>(app, NOTES, `getComputedStyle(document.documentElement).getPropertyValue("--tavora-background").trim()`).catch(() => null))
        .toBe(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--background").trim()));
      // The panel is made again after a workspace switch, so the editor and its placeholder take a moment.
      let placeholder: Painted = null;
      await expect
        .poll(async () => {
          placeholder =
            (await paintedInNotes(app, ".note-content p.is-editor-empty:first-child", "::before").catch(() => null)) ??
            (await paintedInNotes(app, "input[placeholder]", "::placeholder").catch(() => null));
          return placeholder !== null;
        })
        .toBe(true);
      record(theme.name, mode, "Notes placeholder", placeholder);
    }
  }

  const table = ["| Theme | Mode | Spot | Text | Background | Ratio | Needs |", "|---|---|---|---|---|---|---|"];
  for (const row of rows) table.push(`| ${row.theme} | ${row.mode} | ${row.spot} | ${row.text} | ${row.fill} | ${row.ratio.toFixed(2)}:1 | ${NEEDS[row.spot]}:1 |`);
  console.log(table.join("\n"));

  const short = rows.filter((row) => row.ratio < NEEDS[row.spot]).map((row) => `${row.theme} ${row.mode}: ${row.spot} is ${row.ratio.toFixed(2)}:1, needs ${NEEDS[row.spot]}:1`);
  expect(short).toEqual([]);
  await app.close();
});

/** Every button on the page without an accessible name, as "testid or outerHTML start". */
async function unnamedButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const named = (element: Element): boolean => {
      const label = element.getAttribute("aria-label")?.trim();
      if (label) return true;
      const by = element.getAttribute("aria-labelledby");
      if (by && by.split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim())) return true;
      if (element.textContent?.trim()) return true;
      if (element.querySelector("img[alt]:not([alt=''])")) return true;
      if (element.getAttribute("title")?.trim()) return true;
      // A control inside a label (a checkbox before its words) is named by the label.
      if (element.closest("label")?.textContent?.trim()) return true;
      return false;
    };
    return Array.from(document.querySelectorAll("button, [role='button']"))
      .filter((element) => !named(element))
      .map((element) => element.getAttribute("data-testid") ?? element.outerHTML.slice(0, 120));
  });
}

test("every button on Home, in a workspace and in Settings has a name", async () => {
  test.setTimeout(120_000);
  const { app, page } = await launch();
  const found: Record<string, string[]> = {};

  await page.getByTestId("rail-home").click();
  found.home = await unnamedButtons(page);

  await openWorkspace(page, "satisfactory");
  await openModule(page, NOTES);
  await openModule(page, TODOS);
  await openModule(page, "tavora.calculator");
  await expect(page.locator("[data-panel-tab]")).toHaveCount(3);
  found.workspace = await unnamedButtons(page);
  // Screen readers hear what changes on its own: the workspace notice and the toast's region, which waits empty.
  await expect(page.getByTestId("notice")).toHaveAttribute("role", "status");
  await expect(page.locator('[role="status"][aria-live="polite"]')).not.toHaveCount(0);

  await page.getByTestId("rail-settings").click();
  await expect(page.getByTestId("settings")).toBeVisible();
  const sections = await page.locator('[data-testid^="settings-nav-"]:not([data-testid$="-count"]):not([data-testid$="-new"])').evaluateAll((items) => items.map((item) => item.getAttribute("data-testid")!));
  for (const section of sections) {
    await page.getByTestId(section).click();
    found[section] = await unnamedButtons(page);
  }
  await page.keyboard.press("Escape");
  await page.getByTestId("rail-profile").click();
  const parts = await page.locator('[data-testid^="profile-nav-"]').evaluateAll((items) => items.map((item) => item.getAttribute("data-testid")!));
  for (const part of parts) {
    await page.getByTestId(part).click();
    found[part] = await unnamedButtons(page);
  }

  const problems = Object.entries(found).flatMap(([where, list]) => list.map((item) => `${where}: ${item}`));
  expect(problems).toEqual([]);
  await app.close();
});
