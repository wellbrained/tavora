// `pnpm check:modules [folder…]`: finds breaks of docs/module-rules.md in module source (src/**/*.vue|ts|css), so they
// don't depend on someone remembering the rulebook. With no folders it checks every module under the current folder
// (tavora: modules/*; tavora-modules: each module folder). A folder may be one module or a folder of modules.
//
// Exceptions: `// rules-allow: <rule> <reason>` (or `/* … */`, `<!-- … -->`) on the line or the line before. A file
// whose whole content is an exception (a game's rarity palette) takes `rules-allow-file: <rule> <reason>` anywhere.
// Known breaks: module-rules-baseline.json in the current folder; only findings beyond it fail. `--update-baseline`
// rewrites it, `--counts` prints the findings per rule and per module.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const BASELINE_FILE = "module-rules-baseline.json";

const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTILITY = "bg|text|border|border-[trblxyse]|ring|ring-offset|outline|divide|fill|stroke|from|via|to|accent|caret|decoration|placeholder|shadow";
const NAMED = "white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|gold|brown|navy|teal|maroon|olive|lime|aqua|cyan|magenta|fuchsia|crimson|tomato|coral|salmon|khaki|indigo|violet|beige|ivory|tan|darkgr[ae]y|lightgr[ae]y|whitesmoke|gainsboro";
const COLOR_PROPS = "color|background|background-color|border|border-(?:top|right|bottom|left)|border(?:-[a-z]+)?-color|outline|outline-color|fill|stroke|caret-color|accent-color|text-decoration-color|column-rule-color";
const SPACE_UTILITY = "p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y";
const SPACE_STEPS = new Set(["0", "1", "2", "3", "4", "6", "8"]);
const SPACE_PX = new Set([0, 4, 8, 12, 16, 24, 32]);
const TEXT_SCALE = new Set([12, 13, 14, 16, 20]);

/** The rules: id, the one-line fix hint, and where each looks (css, template, script). */
export const RULES = {
  "color-literal": "Use a token class (bg-card, text-muted-foreground, border-border) or var(--card); no hex, rgb() or hsl().",
  "color-fallback": "Drop the fallback: var(--warning), never var(--warning, #f5c518).",
  "named-color": "Use a token (var(--foreground), var(--background)) instead of a named colour.",
  "palette-color": "Use a theme token class (bg-card, text-foreground, text-destructive) instead of a Tailwind palette colour.",
  "font-family": "Use the theme's font: font-sans / font-mono, or var(--font-sans) / var(--font-mono).",
  "text-size": "Nothing under 12 px: use text-xs (12) or larger.",
  "text-scale": "Use a size from the scale: text-xs 12, text-sm 13, text-base 14, text-lg 16, text-xl 20.",
  "font-weight": "Use weights 400, 500 or 600 only (font-normal, font-medium, font-semibold).",
  "radius-px": "Use the kit's corners (rounded-sm, rounded-md, rounded-lg or var(--radius-*)), never a px radius.",
  "z-index": "No own z-index outside a canvas or map; use the kit's floating layers (Popover, Dialog, Tooltip).",
  "motion-token": "Use the kit's motion tokens (--ease-out-strong, --duration-*) and name the properties; no transition-all.",
  spacing: "Use the spacing scale: 4, 8, 12, 16, 24, 32 px (Tailwind 1, 2, 3, 4, 6, 8).",
  shadow: "No own shadows: areas separate by a surface step and border-border; floating layers bring their own.",
  "focus-ring": "Keep the kit's focus ring: don't remove the outline or draw your own ring.",
  "raw-control": "Use the kit control (Button, Select, Table, Collapsible, Slider, Checkbox, RadioGroup, Dialog, Progress, ColorPicker).",
  "dom-query": "Reach your own elements through template refs; a pane may be shown twice.",
  "window-keys": "Listen for keys on the pane's own element, not window or document.",
  "menu-anchor": "Open menus next to their element: ui.showMenu({ anchor: element }), never at the pointer.",
  "file-save": "Save through files.saveJson or pictures.save (Tavora's save dialog), never a download link.",
  "glued-text": "Use one translated text with placeholders, not interpolations glued together in the template.",
  "catalog-check": "Add a locales test: checkCatalogs(en, de) from @tavora/official-ui/testing.",
  "suspend-flush": "Register lifecycle.onSuspend and lifecycle.onDispose and flush pending saves and panel state there.",
  "view-memory-flush": "Call flushViewMemory() (from @tavora/official-ui) in onSuspend and onDispose.",
  "panel-state-read": "Read panel state back on start with panel.getState(); writing it without reading it is the common bug.",
  "allow-comment": "Write rules-allow: <rule> <reason>, with a known rule id and a reason.",
};

const ALLOW = /rules-allow(-file)?:\s*([a-z][a-z-]*(?:\s*,\s*[a-z][a-z-]*)*)?\s*(.*)/;

// ---------------------------------------------------------------------------------------------------------------------
// Source layout: which part of a file is CSS, template or script, with comments blanked out (offsets and lines kept).

/** Blanks comments (keeping newlines) in one kind of source. Strings stay, so a "//" in a URL is not a comment. */
export function maskComments(text, lang) {
  const out = text.split("");
  const blank = (from, to) => {
    for (let i = from; i < to; i++) if (out[i] !== "\n" && out[i] !== "\r") out[i] = " ";
  };
  let i = 0;
  while (i < text.length) {
    if (lang === "template") {
      if (text.startsWith("<!--", i)) {
        const end = text.indexOf("-->", i + 4);
        const stop = end < 0 ? text.length : end + 3;
        blank(i, stop);
        i = stop;
      } else i++;
      continue;
    }
    const c = text[i];
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (lang === "script" && c === "/" && text[i + 1] === "/") {
      let stop = text.indexOf("\n", i);
      if (stop < 0) stop = text.length;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'" || (lang === "script" && c === "`")) {
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\") i++;
        else if (c !== "`" && text[i] === "\n") break;
        i++;
      }
      i++;
    } else i++;
  }
  return out.join("");
}

/** The file's text per kind ({ css, template, script }), each the full length with the other parts blanked. */
export function splitSource(text, file) {
  const ext = path.extname(file);
  const empty = text.replace(/[^\r\n]/g, " ");
  if (ext === ".css") return { css: maskComments(text, "css"), template: empty, script: empty };
  if (ext !== ".vue") return { css: empty, template: empty, script: maskComments(text, "script") };
  const parts = { css: empty.split(""), template: empty.split(""), script: empty.split("") };
  const block = /^<(template|script|style)\b[^>]*>([\s\S]*?)^<\/\1>/gm;
  for (const match of text.matchAll(block)) {
    const kind = match[1] === "style" ? "css" : match[1];
    const start = match.index + match[0].indexOf(">") + 1;
    const body = maskComments(match[2], kind);
    for (let k = 0; k < body.length; k++) parts[kind][start + k] = body[k];
  }
  return { css: parts.css.join(""), template: parts.template.join(""), script: parts.script.join("") };
}

// ---------------------------------------------------------------------------------------------------------------------
// Line rules. Each returns the matches it found as { index, message } in one kind of text.

function* matches(text, regex, message) {
  for (const m of text.matchAll(regex)) {
    const msg = typeof message === "function" ? message(m) : message;
    if (msg) yield { index: m.index, message: msg.replace(/\s+/g, " ") };
  }
}

const px = (value, unit) => (unit === "rem" ? Number(value) * 16 : Number(value));

/** A text-size class (text-NAME) the module defines under 12 px in its own CSS: { NAME: px }. */
export function smallTextTokens(cssTexts) {
  const tokens = {};
  for (const text of cssTexts) {
    for (const m of text.matchAll(/--text-([a-z0-9]+):\s*([\d.]+)(px|rem)\b/g)) {
      if (px(m[2], m[3]) < 12) tokens[m[1]] = px(m[2], m[3]);
    }
  }
  return tokens;
}

const declarations = {
  "font-size": /font-size:\s*([\d.]+)(px|rem)\b/g,
  "font-weight": /font-weight:\s*(\d+|bold|bolder|lighter)\b/g,
};

function sizeMessage(size) {
  if (size < 12) return { rule: "text-size", message: `Text size ${size} px is under 12 px.` };
  if (size < 20 && !TEXT_SCALE.has(size)) return { rule: "text-scale", message: `Text size ${size} px is between the scale's steps.` };
  return null;
}

/** Every line rule over one file: [{ rule, index, message }]. */
export function lineFindings(source, context = {}) {
  const { css, template, script } = source;
  const all = [css, template, script];
  const found = [];
  const add = (rule, iter) => {
    for (const hit of iter) found.push({ rule, ...hit });
  };

  // Tailwind classes in CSS only appear in @apply; elsewhere ease-out or z-index are CSS words, checked further down.
  const applied = css.replace(/[^\r\n]/g, " ").split("");
  for (const m of css.matchAll(/@apply\b[^;}]*/g)) for (let k = 0; k < m[0].length; k++) applied[m.index + k] = m[0][k];
  const cssClasses = applied.join("");
  for (const text of all) {
    // Colours.
    const fallbacks = [...text.matchAll(/var\(\s*--[\w-]+\s*,\s*(#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|oklch|oklab)\([^)]*\)|[a-z]+)\s*\)/g)].filter(
      (m) => !/^(?:transparent|inherit|initial|unset|currentcolor)$/i.test(m[1]) && (m[1].startsWith("#") || m[1].includes("(") || new RegExp(`^(?:${NAMED})$`).test(m[1])),
    );
    add("color-fallback", fallbacks.map((m) => ({ index: m.index, message: `Colour fallback ${m[1]} in ${m[0]}.` })));
    const inFallback = (index) => fallbacks.some((m) => index >= m.index && index < m.index + m[0].length);
    add(
      "color-literal",
      matches(text, /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|\b(?:rgba?|hsla?|oklch|oklab|hwb)\(/g, (m) =>
        inFallback(m.index) ? null : `Colour literal ${m[0].endsWith("(") ? `${m[0]}…)` : m[0]}.`,
      ),
    );
  }
  for (const text of [cssClasses, template, script]) {
    add(
      "palette-color",
      matches(
        text,
        new RegExp(`(?<![\\w-])(?:${UTILITY})-(?:(?:${PALETTE})-\\d{2,3}|white|black)(?:\\/\\d+)?(?![\\w-])`, "g"),
        (m) => `Tailwind palette colour ${m[0]}.`,
      ),
    );

    // Type.
    add("font-family", matches(text, text !== script ? /(?<![\w-])font-\[[^\]]+\]/g : /(?<![\w-])font-\[[^\]]+\]|["'](?:Inter(?: Variable)?|JetBrains Mono(?: Variable)?|Arial|Helvetica|Roboto|Segoe UI|Consolas|Menlo|Courier New)["']/g, (m) => `Literal font ${m[0]}.`));
    add(
      "text-size",
      matches(text, /(?<![\w-])text-\[([\d.]+)(px|rem)\]/g, (m) => (px(m[1], m[2]) < 12 ? `Text size ${m[0]} is under 12 px.` : null)),
    );
    add(
      "text-scale",
      matches(text, /(?<![\w-])text-\[([\d.]+)(px|rem)\]/g, (m) => {
        const size = px(m[1], m[2]);
        return size >= 12 && size < 20 && !TEXT_SCALE.has(size) ? `Text size ${m[0]} is between the scale's steps.` : null;
      }),
    );
    for (const [token, size] of Object.entries(context.smallText ?? {})) {
      add("text-size", matches(text, new RegExp(`(?<![\\w-])text-${token}(?![\\w-])`, "g"), `text-${token} is ${size} px, under 12 px.`));
    }
    add("font-weight", matches(text, /(?<![\w-])font-(?:thin|extralight|light|bold|extrabold|black)(?![\w-])/g, (m) => `Font weight ${m[0]}.`));

    // Shape, depth, focus, motion, spacing (Tailwind classes, anywhere a class list can be).
    add("radius-px", matches(text, /(?<![\w-])rounded(?:-[a-z]+)?-\[[\d.]+px\]/g, (m) => `Px radius ${m[0]}.`));
    add("z-index", matches(text, /(?<![\w:-])-?z-(?:\d+|\[[^\]]+\])(?![\w-])/g, (m) => `Own z-index ${m[0]}.`));
    add("shadow", matches(text, /(?<![\w-])(?:drop-)?shadow-(?:2xs|xs|sm|md|lg|xl|2xl|inner|\[[^\]]+\])(?![\w-])/g, (m) => `Own shadow ${m[0]}.`));
    add("focus-ring", matches(text, /(?<![\w-])(?:outline-none|outline-hidden|focus(?:-visible|-within)?:(?:ring|outline)[\w-]*)(?![\w-])/g, (m) => `Own focus style ${m[0]}.`));
    add(
      "motion-token",
      matches(text, /(?<![\w-])(?:transition-all|ease-(?:in|out|in-out|linear|\[[^\]]+\])|duration-(?:\d+|\[[^\]]+\]))(?![\w-])|cubic-bezier\(/g, (m) =>
        `Hand-typed motion ${m[0].endsWith("(") ? "cubic-bezier()" : m[0]}.`,
      ),
    );
    add(
      "spacing",
      matches(text, new RegExp(`(?<![\\w:\\[-])-?(?:${SPACE_UTILITY})-(\\d+(?:\\.\\d+)?|\\[[^\\]]+\\])(?![\\w.-])`, "g"), (m) =>
        SPACE_STEPS.has(m[1]) || m[1].startsWith("[var(") ? null : `Off-scale spacing ${m[0].replace(/^-/, "")}.`,
      ),
    );
  }

  // CSS declarations (style blocks, .css files, and style="" attributes in templates). An @font-face block names the
  // font it defines, which is not a use of it.
  const declared = css.replace(/@font-face\s*\{[^}]*\}/g, (block) => block.replace(/[^\r\n]/g, " "));
  for (const text of [declared, template]) {
    add(
      "named-color",
      matches(text, new RegExp(`(?<![\\w-])(?:${COLOR_PROPS}):\\s*[^;"}]*?(?<![\\w-])(${NAMED})(?![\\w-])`, "gi"), (m) => `Named colour ${m[1]}.`),
    );
    add(
      "font-family",
      matches(text, /(?<![\w-])font-family:(?!\s*(?:var\(|inherit|initial|unset|revert))\s*([^;}\n]+)/g, (m) => `Literal font-family: ${m[1].trim()}.`),
    );
    for (const m of text.matchAll(declarations["font-size"])) {
      const hit = sizeMessage(px(m[1], m[2]));
      if (hit) found.push({ ...hit, index: m.index });
    }
    for (const m of text.matchAll(/(?<![\w-])--text-([a-z0-9]+):\s*([\d.]+)(px|rem)\b/g)) {
      if (px(m[2], m[3]) < 12) found.push({ rule: "text-size", index: m.index, message: `--text-${m[1]} is ${px(m[2], m[3])} px, under 12 px.` });
    }
    add(
      "font-weight",
      matches(text, declarations["font-weight"], (m) => (["400", "500", "600"].includes(m[1]) ? null : `font-weight: ${m[1]}.`)),
    );
    add(
      "radius-px",
      matches(text, /(?<![\w-])border(?:-[a-z]+)*-radius:\s*([^;"}]+)/g, (m) => {
        const sizes = [...m[1].matchAll(/(?<![\w.(-])([\d.]+)px/g)].map((s) => Number(s[1]));
        return sizes.some((s) => s > 0 && s < 999) && !m[1].includes("var(") ? `Px radius border-radius: ${m[1].trim()}.` : null;
      }),
    );
    add("z-index", matches(text, /(?<![\w-])z-index:\s*(-?\d+)/g, (m) => `Own z-index: ${m[1]}.`));
    add("shadow", matches(text, /(?<![\w-])box-shadow:(?!\s*(?:none|var\())\s*([^;"}]+)/g, (m) => `Own box-shadow: ${m[1].trim()}.`));
    add("focus-ring", matches(text, /(?<![\w-])outline:\s*(?:none|0)(?![\w.])/g, (m) => `Focus ring removed (${m[0]}).`));
    add(
      "motion-token",
      matches(text, /(?<![\w-])(?:transition|animation)(?:-[a-z-]+)?:\s*([^;"}]+)/g, (m) => {
        const value = m[1].replace(/var\([^)]*\)/g, "");
        if (/^\s*(?:none|inherit)\s*$/.test(value)) return null;
        if (/(?<![\w-])all(?![\w-])/.test(value)) return `transition: all.`;
        if (/(?<![\w-])(?:ease|ease-in|ease-out|ease-in-out|linear)(?![\w-])/.test(value)) return `Hand-typed curve in ${m[0].trim()}.`;
        if (/(?<![\w.-])\d*\.?\d+m?s(?![\w-])/.test(value)) return `Hand-typed duration in ${m[0].trim()}.`;
        return null;
      }),
    );
    add(
      "spacing",
      matches(text, /(?<![\w-])(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z-]+)?:\s*([^;"}]+)/g, (m) => {
        const off = [...m[1].matchAll(/(?<![\w.(-])-?([\d.]+)px/g)].map((s) => Number(s[1])).filter((s) => !SPACE_PX.has(s));
        return off.length > 0 && !m[1].includes("calc(") ? `Off-scale spacing ${m[0].trim()}.` : null;
      }),
    );
  }

  // Template: raw controls and glued sentences.
  add(
    "raw-control",
    matches(template, /<(button|select|table|details|dialog|progress)(?=[\s>/])|<input\b[^>]*?\btype=["'](range|checkbox|radio|color)["']/g, (m) =>
      `Raw <${m[1] ?? `input type="${m[2]}"`}>.`,
    ),
  );
  add("file-save", matches(template, /<a\b[^>]*?\sdownload(?=[\s=>/])/g, "Download link instead of Tavora's save dialog."));
  add("glued-text", matches(template, /\}\}\s*[·•|–—/,:-]\s*\{\{/g, "Interpolations glued together with a separator."));

  // Script.
  add(
    "raw-control",
    matches(script, /createElement\(\s*["'](button|select|table|details|dialog|progress)["']/g, (m) => `Raw <${m[1]}> from createElement.`),
  );
  // Pages without Vue (an overlay's plain page) have no refs and are never shown twice.
  if (context.vue) for (const text of [script, template]) add(
    "dom-query",
    matches(text, /\bdocument\.(querySelector(?:All)?|getElementById|getElementsBy(?:ClassName|TagName|Name))\(\s*(["'`][^"'`]*["'`])?/g, (m) =>
      m[2] && /^["'`]#?app["'`]$/.test(m[2]) ? null : `document.${m[1]}().`,
    ),
  );
  add(
    "window-keys",
    matches(script, /\b(?:window|document)\.addEventListener\(\s*["'`]key(?:down|up|press)["'`]|useEventListener\(\s*(?:window|document)\s*,\s*["'`]key(?:down|up|press)/g, "Window-wide key listener."),
  );
  add(
    "menu-anchor",
    matches(script, /\bshowMenu\(/g, (m) => {
      const call = callText(script, m.index + m[0].length - 1);
      return /\b(?:clientX|clientY|pageX|pageY|screenX|screenY|offsetX|offsetY)\b/.test(call) && !/\banchor\b/.test(call) ? "Menu at the pointer." : null;
    }),
  );
  add("file-save", matches(script, /\.download\s*=|\bshowSaveFilePicker\(/g, "Download instead of Tavora's save dialog."));
  return found;
}

// ---------------------------------------------------------------------------------------------------------------------
// Allow comments.

/** The allow comments in a file: per line the rules it allows, the file-wide ones, and broken comments. */
export function readAllows(lines) {
  const byLine = new Map();
  const fileWide = new Set();
  const broken = [];
  lines.forEach((line, i) => {
    const m = ALLOW.exec(line);
    if (!m) return;
    const rules = (m[2] ?? "").split(",").map((r) => r.trim()).filter(Boolean);
    const reason = m[3].replace(/\*\/|-->/g, "").trim();
    const unknown = rules.filter((r) => !(r in RULES) || r === "allow-comment");
    if (rules.length === 0 || unknown.length > 0 || reason.length < 3) {
      const why = rules.length === 0 ? "no rule" : unknown.length > 0 ? `unknown rule ${unknown.join(", ")}` : "no reason";
      broken.push({ line: i + 1, message: `Allow comment with ${why}.` });
      return;
    }
    if (m[1]) rules.forEach((r) => fileWide.add(r));
    else byLine.set(i + 1, new Set(rules));
  });
  return { byLine, fileWide, broken };
}

const allowed = (allows, rule, line) => allows.fileWide.has(rule) || allows.byLine.get(line)?.has(rule) || allows.byLine.get(line - 1)?.has(rule);

// ---------------------------------------------------------------------------------------------------------------------
// Files and modules.

const isCatalog = (file) => /(?:^|[/.])(?:locales?|i18n|texts)(?:\.[a-z]{2})?\.ts$/.test(file);
const isSource = (name) => /\.(vue|ts|css)$/.test(name) && !/\.(test|spec)\.ts$|\.d\.ts$/.test(name);

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "__snapshots__" ? [] : walk(full);
    return [full];
  });
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOf(starts, index) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** One file's text, split into lines with what the check needs. */
function readSource(file, text) {
  const lines = text.split(/\r?\n/);
  return { file, text, lines, source: splitSource(text, file), starts: lineStarts(text), allows: readAllows(lines) };
}

/**
 * Checks one module's files: { [relative path]: text } plus test files (only searched for checkCatalogs).
 * Returns [{ file, line, rule, message, text }], the line's text being what the baseline matches on.
 */
export function checkModuleFiles(files, tests = {}) {
  const sources = Object.entries(files).map(([file, text]) => readSource(file, text));
  const context = { smallText: smallTextTokens(sources.map((s) => s.source.css)) };
  const findings = [];
  const push = (src, line, rule, message) => {
    if (rule !== "allow-comment" && allowed(src.allows, rule, line)) return;
    findings.push({ file: src.file, line, rule, message, text: normalise(src.lines[line - 1] ?? "") });
  };

  for (const src of sources) {
    for (const b of src.allows.broken) push(src, b.line, "allow-comment", b.message);
    // A catalog of texts is words, not code: "ease-in" or "#123" there is part of a sentence.
    if (isCatalog(src.file)) continue;
    const seen = new Set();
    const vue = src.file.endsWith(".vue") || /from\s+["'](?:vue|@tavora\/official-ui[^"']*)["']/.test(src.text);
    for (const hit of lineFindings(src.source, { ...context, vue })) {
      const line = lineOf(src.starts, hit.index);
      const key = `${line}:${hit.rule}:${hit.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      push(src, line, hit.rule, hit.message);
    }
  }

  // Module-wide rules: a trigger somewhere, the answer missing everywhere.
  const code = (src) => src.source.script + src.source.template;
  const anywhere = (regex) => sources.some((src) => regex.test(code(src)));
  const first = (regex) => {
    for (const src of sources) {
      const m = regex.exec(code(src));
      if (m) return { src, line: lineOf(src.starts, m.index) };
    }
    return null;
  };

  const catalog = first(/\bexport\s+const\s+(?:en|de)\s*[:=]|\bconnectModule\(\s*\{[^}]*\btexts\b/);
  if (catalog && !Object.values(tests).some((text) => /\bcheckCatalogs\(/.test(text))) {
    push(catalog.src, catalog.line, "catalog-check", "Catalogs without a checkCatalogs test.");
  }

  const delayed = delayedSave(sources);
  if (delayed) {
    const missing = ["onSuspend", "onDispose"].filter((hook) => !anywhere(new RegExp(`\\b${hook}\\(`)));
    if (missing.length > 0) push(delayed.src, delayed.line, "suspend-flush", `Panel state or a delayed save without ${missing.join(" and ")}.`);
  }

  const view = first(/\bpersist-key\b|:persistKey\b|\bpersistKey\s*[:=]|\bcreateViewMemory\(/);
  if (view && !anywhere(/\bflushViewMemory\(/)) push(view.src, view.line, "view-memory-flush", "Saved map view without flushViewMemory().");

  const write = first(/\.setState\(\s*(?!null\b)/);
  if (write && !anywhere(/\.getState\b|\brestore\w*\s*[(:]/)) push(write.src, write.line, "panel-state-read", "Panel state is written but never read back.");

  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
}

/** A save that waits for a timer (setTimeout, debounce) whose callback saves, writes or flushes: its first one. */
function delayedSave(sources) {
  for (const src of sources) {
    const text = src.source.script;
    for (const m of text.matchAll(/\b(?:setTimeout|debounce\w*|useDebounceFn|watchDebounced)\(/g)) {
      const body = callText(text, m.index + m[0].length - 1);
      if (/save|flush|setState|persist|write|store\./i.test(body)) return { src, line: lineOf(src.starts, m.index) };
    }
  }
  return null;
}

/** The text of a call from its opening bracket to the matching one (at most 800 characters). */
function callText(text, open) {
  let depth = 0;
  for (let i = open; i < Math.min(text.length, open + 800); i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open, open + 800);
}

const normalise = (line) => line.trim().replace(/\s+/g, " ").slice(0, 240);

/** The module folders under `folder`: itself if it is one, else each child (and modules/*) with a tavora.module.json. */
export function findModules(folder) {
  if (existsSync(path.join(folder, "tavora.module.json"))) return [folder];
  const found = [];
  for (const base of [folder, path.join(folder, "modules")]) {
    if (!existsSync(base) || !statSync(base).isDirectory()) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(path.join(base, entry.name, "tavora.module.json"))) found.push(path.join(base, entry.name));
    }
  }
  return found;
}

const posix = (p) => p.split(path.sep).join("/");

/** Checks the module folder `dir`; paths in findings are relative to `root`, with forward slashes. */
export function checkModule(dir, root) {
  const files = {};
  const tests = {};
  for (const full of walk(path.join(dir, "src"))) {
    const rel = posix(path.relative(root, full));
    if (isSource(path.basename(full))) files[rel] = readFileSync(full, "utf8");
    else if (/\.(test|spec)\.ts$/.test(full)) tests[rel] = readFileSync(full, "utf8");
  }
  return checkModuleFiles(files, tests);
}

// ---------------------------------------------------------------------------------------------------------------------
// Baseline: known breaks by file, rule and the line's text, with a count. A line that moves keeps its text and stays
// known; a new break, even on the line number an old one had, has its own text (or raises a count) and fails.

const keyOf = (f) => `${f.file}\u0000${f.rule}\u0000${f.text}`;

export function toBaseline(findings) {
  const counts = new Map();
  for (const f of findings) {
    const key = keyOf(f);
    const entry = counts.get(key) ?? { file: f.file, rule: f.rule, text: f.text, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  return {
    about: "Known breaks of docs/module-rules.md. Fix them, don't add to them: pnpm check:modules --update-baseline rewrites this file.",
    findings: [...counts.values()].sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule) || a.text.localeCompare(b.text)),
  };
}

/** Splits findings into new ones and known ones, and counts baseline entries that are fixed now. */
export function compareBaseline(findings, baseline) {
  const left = new Map((baseline?.findings ?? []).map((e) => [keyOf(e), e.count]));
  const fresh = [];
  const known = [];
  for (const f of findings) {
    const key = keyOf(f);
    const n = left.get(key) ?? 0;
    if (n > 0) {
      left.set(key, n - 1);
      known.push(f);
    } else fresh.push(f);
  }
  const fixed = [...left.values()].reduce((sum, n) => sum + n, 0);
  return { fresh, known, fixed };
}

// ---------------------------------------------------------------------------------------------------------------------
// Command line.

export function countBy(findings, pick) {
  const counts = {};
  for (const f of findings) counts[pick(f)] = (counts[pick(f)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function moduleOf(file) {
  const parts = file.split("/");
  return parts[0] === "modules" ? parts[1] : parts[0];
}

export function main(argv, cwd = process.cwd(), log = console.log) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const folders = argv.filter((a) => !a.startsWith("--"));
  const modules = (folders.length > 0 ? folders : [cwd]).flatMap((f) => findModules(path.resolve(cwd, f)));
  if (modules.length === 0) {
    log("check:modules: no module found (a folder with tavora.module.json).");
    return 1;
  }
  const findings = modules.flatMap((dir) => checkModule(dir, cwd));
  const baselinePath = path.join(cwd, BASELINE_FILE);
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : { findings: [] };
  const scanned = new Set(modules.map((dir) => posix(path.relative(cwd, dir)) + "/"));
  const inScope = (file) => [...scanned].some((prefix) => file.startsWith(prefix));

  if (flags.has("--update-baseline")) {
    const kept = baseline.findings.filter((e) => !inScope(e.file));
    const next = toBaseline(findings);
    next.findings = [...kept, ...next.findings].sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule) || a.text.localeCompare(b.text));
    writeFileSync(baselinePath, JSON.stringify(next, null, 2) + "\n");
    log(`check:modules: wrote ${BASELINE_FILE} with ${findings.length} known break(s) in ${modules.length} module(s).`);
    return 0;
  }

  const { fresh, known, fixed } = compareBaseline(findings, { findings: baseline.findings.filter((e) => inScope(e.file)) });
  for (const f of fresh) log(`${f.file}:${f.line}  ${f.rule}  ${f.message} ${RULES[f.rule]}`);
  if (flags.has("--counts")) {
    log("\nPer rule:");
    for (const [rule, n] of Object.entries(countBy(findings, (f) => f.rule))) log(`  ${rule.padEnd(18)} ${n}`);
    log("\nPer module:");
    for (const [name, n] of Object.entries(countBy(findings, (f) => moduleOf(f.file)))) log(`  ${name.padEnd(18)} ${n}`);
    log("");
  }
  const tail = fixed > 0 ? ` ${fixed} known break(s) are fixed now: run pnpm check:modules --update-baseline to drop them.` : "";
  if (fresh.length > 0) {
    log(`\ncheck:modules: ${fresh.length} new break(s) of docs/module-rules.md (${known.length} known).${tail}`);
    log("A real exception (game art, PDF paper, canvas drawing): // rules-allow: <rule> <reason> on the line or the line before.");
    return 1;
  }
  log(`check:modules: ${modules.length} module(s), no new breaks (${known.length} known).${tail}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
