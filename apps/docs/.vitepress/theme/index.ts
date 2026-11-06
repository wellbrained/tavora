import type { Theme } from "vitepress";
import { inBrowser, onContentUpdated } from "vitepress";
import DefaultTheme from "vitepress/theme";
import "./tokens.css";

// Picking a tab in one code group (pnpm, npm, Yarn, Bun, Vite+) picks the tab with the same label in every
// other group, on this page and the next ones, and the choice is remembered. VitePress switches the
// clicked group itself; this only follows it in the others.

const KEY = "tavora-docs-code-tab";

function remembered(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function remember(title: string): void {
  try {
    localStorage.setItem(KEY, title);
  } catch {
    // Storage is off (private window, blocked site data): the tabs still follow on this page.
  }
}

const titleOf = (label: Element) => (label.getAttribute("data-title") ?? label.textContent ?? "").trim();

/** Shows the tab labelled `title` in every code group that has one, except `skip`. */
function show(title: string, skip?: Element): void {
  for (const group of document.querySelectorAll(".vp-code-group")) {
    if (group === skip) continue;
    const labels = Array.from(group.querySelectorAll(":scope > .tabs > label"));
    const index = labels.findIndex((label) => titleOf(label) === title);
    if (index < 0) continue;
    const input = group.querySelector<HTMLInputElement>(`#${CSS.escape(labels[index]!.getAttribute("for") ?? "")}`);
    if (input) input.checked = true;
    const blocks = group.querySelector(":scope > .blocks")?.children;
    if (!blocks?.[index]) continue;
    for (const block of blocks) block.classList.toggle("active", block === blocks[index]);
  }
}

if (inBrowser) {
  window.addEventListener("click", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches(".vp-code-group input")) return;
    const group = input.closest(".vp-code-group");
    const label = group?.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (!group || !label) return;
    const title = titleOf(label);
    remember(title);
    show(title, group);
  });
}

export default {
  extends: DefaultTheme,
  setup() {
    onContentUpdated(() => {
      const title = remembered();
      if (title) show(title);
    });
  },
} satisfies Theme;
