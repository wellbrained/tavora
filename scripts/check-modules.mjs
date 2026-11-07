// `pnpm check:modules [folder…]`: finds breaks of docs/module-rules.md in module source (`src/**/*.vue`, `.ts`, `.tsx`,
// `.css`, without tests), so they don't depend on someone remembering the rulebook. With no folder it checks the
// modules in `modules/` (or, where there is none, the module folders in the current folder, as in tavora-modules).
// A folder is a module (it has a tavora.module.json) or holds modules.
//
// Known breaks are kept in module-rules-baseline.json in the current folder; only new ones fail (exit code 1).
// `--update-baseline` rewrites it for the checked modules. A real exception (game art, the paper of a PDF page, canvas
// drawing) gets `// rules-allow: <rule> <reason>` (or `/* … */`, `<!-- … -->`) on its line or alone on the line before.
// `--all` lists the known breaks too, `--summary` counts every break per rule and per module, `--json` prints them all.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Every rule: what to do instead, in one line. */
export const RULES = {
  color: "Use a theme token (bg-card, text-muted-foreground, var(--primary)…), not a colour of your own.",
  "color-fallback": "Write var(--token) alone; the theme always sets it.",
  palette: "Use a theme token class (bg-muted, text-foreground, border-border…), not a Tailwind palette colour.",
  "font-family": "Use the theme's font: font-sans, font-mono or var(--font-sans).",
  "font-size": "Use the scale: text-xs 12, text-sm 13, text-base 14, text-lg 16, text-xl 20 px.",
  "font-weight": "Use weight 400, 500 or 600 (font-normal, font-medium, font-semibold).",
  radius: "Use the kit's corners (rounded-sm, rounded-md, rounded-lg), not a length of your own.",
  "kit-control": "Use the kit's control (kit map in docs/module-rules.md).",
  "dom-query": "Reach your own elements through a template ref; the component may be shown twice.",
  "suspend-flush": "Register lifecycle.onSuspend and onDispose and write the pending save there.",
  "view-flush": "Call flushViewMemory() in onSuspend and onDispose.",
  "panel-state-read": "Read the panel state back on start with panel.getState().",
  catalogs: "Add a test that runs checkCatalogs(en, de) on the module's texts.",
  motion: "Use the kit's motion tokens and animate transform and opacity only.",
  "z-index": "No z-index of your own, except inside a canvas or map.",
  shadow: "No shadow of your own: areas separate by a surface step and border-border.",
  "all-caps": "Write it in sentence case; no all caps.",
  "focus-ring": "Keep the kit's focus ring; never remove it or draw your own.",
  "menu-anchor": "Pass the element as anchor: ui.showMenu({ anchor: element }), never the pointer position.",
  "file-save": "Save through files.saveJson or pictures.save (Tavora's save dialog), not a browser download.",
};

/** Problems with an allow comment itself. They are never kept in the baseline. */
export const ALLOW_RULE = "rules-allow";
export const BASELINE_FILE = "module-rules-baseline.json";
const SOURCE = /\.(vue|ts|tsx|css)$/;
const SKIP = /\.(test|spec)\.tsx?$|\.d\.ts$/;

// ── Lexing: where the comments and strings are ───────────────────────────────────────────────────────────────

/** Comments and string contents of TypeScript, as offsets into it. Good enough for module code, not a parser. */
export function lexScript(src) {
  const comments = [];
  const strings = [];
  const keywordBefore = (i) => /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await|delete|new|instanceof)\s*$/.test(src.slice(Math.max(0, i - 12), i));
  function code(i, untilBrace) {
    let depth = 0;
    let prev = "";
    while (i < src.length) {
      const c = src[i];
      const d = src[i + 1];
      if (c === "/" && d === "/") {
        const end = src.indexOf("\n", i);
        const e = end < 0 ? src.length : end;
        comments.push({ start: i, end: e });
        i = e;
      } else if (c === "/" && d === "*") {
        const end = src.indexOf("*/", i + 2);
        const e = end < 0 ? src.length : end + 2;
        comments.push({ start: i, end: e });
        i = e;
      } else if (c === "'" || c === '"') {
        i = quoted(i, c);
        prev = c;
      } else if (c === "`") {
        i = template(i);
        prev = "`";
      } else if (c === "/" && (!prev || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || (/[\w$]/.test(prev) && keywordBefore(i)))) {
        i = regex(i);
        prev = "a";
      } else {
        if (c === "{") depth++;
        else if (c === "}") {
          if (untilBrace && depth === 0) return i + 1;
          depth--;
        }
        if (!/\s/.test(c)) prev = c;
        i++;
      }
    }
    return i;
  }
  function quoted(i, q) {
    let j = i + 1;
    while (j < src.length && src[j] !== q && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
    strings.push({ start: i + 1, end: Math.min(j, src.length) });
    return j + 1;
  }
  function template(i) {
    let j = i + 1;
    let part = j;
    while (j < src.length) {
      if (src[j] === "\\") j += 2;
      else if (src[j] === "`") {
        strings.push({ start: part, end: j });
        return j + 1;
      } else if (src[j] === "$" && src[j + 1] === "{") {
        strings.push({ start: part, end: j });
        j = code(j + 2, true);
        part = j;
      } else j++;
    }
    strings.push({ start: part, end: Math.min(j, src.length) });
    return j;
  }
  function regex(i) {
    let j = i + 1;
    let inClass = false;
    while (j < src.length && src[j] !== "\n") {
      const c = src[j];
      if (c === "\\") j += 2;
      else {
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) {
          j++;
          while (j < src.length && /[a-z]/i.test(src[j])) j++;
          return j;
        }
        j++;
      }
    }
    return j;
  }
  code(0, false);
  return { comments, strings };
}

/** Comments and string contents of CSS. */
export function lexCss(src) {
  const comments = [];
  const strings = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const e = end < 0 ? src.length : end + 2;
      comments.push({ start: i, end: e });
      i = e;
    } else if (src[i] === '"' || src[i] === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== src[i] && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      strings.push({ start: i + 1, end: Math.min(j, src.length) });
      i = j + 1;
    } else i++;
  }
  return { comments, strings };
}

/** HTML comments of a Vue template. */
export function lexTemplate(src) {
  const comments = [];
  const re = /<!--[\s\S]*?(?:-->|$)/g;
  for (let m; (m = re.exec(src)); ) comments.push({ start: m.index, end: m.index + m[0].length });
  return { comments, strings: [] };
}

/** `src` with every range blanked out (newlines kept, so offsets and lines stay). */
function blank(src, ranges) {
  const out = src.split("");
  for (const { start, end } of ranges) for (let i = start; i < end; i++) if (out[i] !== "\n" && out[i] !== "\r") out[i] = " ";
  return out.join("");
}

/** `src` with only the ranges kept. */
function only(src, ranges) {
  const out = src.replace(/[^\r\n]/g, " ").split("");
  for (const { start, end } of ranges) for (let i = start; i < end; i++) out[i] = src[i];
  return out.join("");
}

/** The parts of a file: template, script and style, each as the whole file with the other parts blanked. */
export function regions(file, text) {
  if (file.endsWith(".css")) return [{ kind: "css", text }];
  if (!file.endsWith(".vue")) return [{ kind: "script", text }];
  const blocks = [];
  const re = /<(script|style)\b[^>]*>([\s\S]*?)<\/\1\s*>/g;
  for (let m; (m = re.exec(text)); ) {
    const start = m.index + m[0].indexOf(">") + 1;
    blocks.push({ kind: m[1] === "script" ? "script" : "css", start, end: start + m[2].length, outer: { start: m.index, end: m.index + m[0].length } });
  }
  const parts = [{ kind: "template", text: blank(text, blocks.map((b) => b.outer)) }];
  for (const block of blocks) parts.push({ kind: block.kind, text: only(text, [block]) });
  return parts;
}

// ── Values ────────────────────────────────────────────────────────────────────────────────────────────────────

const NAMED_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue " +
    "chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey " +
    "darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray " +
    "darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen " +
    "fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender " +
    "lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey " +
    "lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen " +
    "magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen " +
    "mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange " +
    "orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple " +
    "rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray " +
    "slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);
const PALETTE = "slate|gray|zinc|neutral|stone|taupe|mauve|mist|olive|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const HEX = /(?<![\w&#/.$-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const COLOR_FN = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi;
const COLOR_PROP = /^(?:--[\w-]+|color|background(?:-color)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|fill|stroke|stop-color|flood-color|lighting-color|box-shadow|text-shadow|caret-color|accent-color|text-decoration(?:-color)?|text-emphasis-color|column-rule(?:-color)?|scrollbar-color)$/;
const SCALE = new Set([12, 13, 14, 16, 20]);
const WEIGHTS = new Set(["400", "500", "600", "normal"]);
const NEUTRAL_VALUES = /^(?:inherit|initial|unset|revert|revert-layer)$/;
const ALLOWED_TRANSITION = new Set(["transform", "opacity", "translate", "scale", "rotate", "none"]);

/** A size in px, or null when it is not a fixed length (em, %, a variable). */
function pixels(number, unit) {
  const value = Number(number);
  if (!Number.isFinite(value)) return null;
  if (unit === "px") return value;
  if (unit === "rem") return value * 16;
  if (unit === "pt") return (value * 4) / 3;
  return null;
}

function sizeProblem(px) {
  if (px === null || px === 0 || px > 20 || SCALE.has(Math.round(px * 100) / 100)) return null;
  return px < 12 ? `${round(px)} px is under 12 px` : `${round(px)} px is between the scale's steps`;
}

const round = (n) => Math.round(n * 100) / 100;
/** `value` with var(…), url(…) and env(…) blanked (same length), since their insides are not this value's own words. */
const withoutCalls = (value) => value.replace(/\b(?:var|url|env)\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, (call) => " ".repeat(call.length));
const stripQuotes = (value) => value.trim().replace(/^(["'`])([\s\S]*)\1$/, "$2");

const GENERIC_FAMILIES = /^(?:serif|sans-serif|monospace|cursive|fantasy|math|emoji|fangsong|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded)$/;

/**
 * What in a font-family list is not the theme's: a font name anywhere (also as a var() fallback), or a generic family
 * on its own. Generic families after the theme's var(--font-…) are only the browser's last resort, so they pass.
 */
function familyProblem(value) {
  const fallbacks = [...value.matchAll(/\bvar\(\s*--[\w-]+\s*,([^()]*)\)/g)].map((m) => m[1]);
  const top = value.replace(/\bvar\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, "var()");
  const parts = [...top.split(","), ...fallbacks.flatMap((f) => f.split(","))].map((part) => part.trim()).filter(Boolean);
  const themed = /var\(/.test(top);
  const own = parts.filter((part) => !part.startsWith("var(") && !NEUTRAL_VALUES.test(part) && !(themed && GENERIC_FAMILIES.test(part)));
  return own.length ? `font-family ${own.join(", ")}` : null;
}

/** Checks of one CSS declaration. `at` is where the value starts; returns [{ index, rule, message }]. */
function checkDeclaration(property, value, at) {
  const out = [];
  const prop = property.toLowerCase();
  const v = value.trim();
  const add = (rule, message) => out.push({ index: at, rule, message });
  const lead = value.length - value.trimStart().length;
  if (COLOR_PROP.test(prop)) {
    for (const m of matches(/[a-zA-Z]+/g, withoutCalls(v))) {
      if (NAMED_COLORS.has(m[0].toLowerCase()) && !/[\w-]/.test(v[m.index - 1] ?? "") && !/[\w-]/.test(v[m.index + m[0].length] ?? "")) {
        out.push({ index: at + lead + m.index, rule: "color", message: `named colour ${m[0]}` });
      }
    }
  }
  if (prop === "font-family") {
    const problem = familyProblem(v);
    if (problem) add("font-family", problem);
  }
  if (prop === "font") {
    const shorthand = /(?:^|\s)(\d*\.?\d+)(px|rem|pt)(?:\s*\/\s*\S+)?\s+(.+)$/.exec(withoutCalls(v));
    if (shorthand) {
      const problem = sizeProblem(pixels(shorthand[1], shorthand[2]));
      if (problem) add("font-size", problem);
      const family = familyProblem(shorthand[3]);
      if (family) add("font-family", family);
    }
  }
  if (prop === "font-size" || (/^--text-[\w-]+$/.test(prop) && !prop.endsWith("line-height"))) {
    const size = /^(\d*\.?\d+)(px|rem|pt)$/.exec(v);
    const problem = size && sizeProblem(pixels(size[1], size[2]));
    if (problem) add("font-size", problem);
  }
  if (prop === "font-weight" && !WEIGHTS.has(v) && !NEUTRAL_VALUES.test(v) && !v.startsWith("var(")) add("font-weight", `font-weight ${v}`);
  if (/^border(?:-[a-z]+)*-radius$/.test(prop)) {
    const lengths = (withoutCalls(v).match(/\d*\.?\d+(?:px|rem|em)\b/g) ?? []).filter((len) => parseFloat(len) > 0 && !(len.endsWith("px") && parseFloat(len) >= 999));
    if (lengths.length) add("radius", `border-radius ${lengths.join(" ")}`);
  }
  if (prop === "z-index" && !/^(?:auto|0)$/.test(v) && !NEUTRAL_VALUES.test(v) && !v.startsWith("var(")) add("z-index", `z-index ${v}`);
  if (prop === "box-shadow" && v !== "none" && !NEUTRAL_VALUES.test(v) && withoutCalls(v).trim() !== "") add("shadow", "box-shadow");
  if (prop === "text-transform" && v === "uppercase") add("all-caps", "text-transform: uppercase");
  if (/^outline(?:-style|-width)?$/.test(prop) && /^(?:none|0)(?:\s|$)/.test(v)) add("focus-ring", `outline: ${v}`);
  if (/^(?:transition|animation)(?:-[a-z-]+)?$/.test(prop) && !prop.endsWith("-name")) {
    const own = withoutCalls(v);
    const reasons = [];
    if (/cubic-bezier\(|steps\(/.test(own)) reasons.push("a curve of your own");
    else if (/(?:^|[\s,])(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)(?=[\s,]|$)/.test(own)) reasons.push("an easing of your own");
    if (/(?:^|[\s,])\d*\.?\d+m?s(?=[\s,]|$)/.test(own)) reasons.push("a duration of your own");
    if (prop === "transition" || prop === "transition-property") {
      const names = own.split(",").map((part) => part.trim().split(/\s+/)[0]).filter((name) => name && !/^\d/.test(name) && !NEUTRAL_VALUES.test(name));
      const wrong = names.filter((name) => !ALLOWED_TRANSITION.has(name));
      if (wrong.length) reasons.push(`it animates ${wrong.join(", ")}`);
    }
    if (reasons.length) add("motion", `${prop}: ${reasons.join(", ")}`);
  }
  return out;
}

const CAMEL_STYLE =
  /(?<![\w$.])(fontFamily|fontSize|fontWeight|borderRadius|zIndex|boxShadow|textTransform|outline|color|backgroundColor|background|borderColor|fill|stroke|transition)\s*:\s*("[^"\n]*"|'[^'\n]*'|-?\d+(?:\.\d+)?)/g;
/** A bare number means something only for zIndex and fontWeight (a fontSize or fontFamily number is some library's own). */
const numericOk = (name, literal, value) => /^["']/.test(literal) ? !(name === "fontSize" && !/[a-z%]$/.test(value)) : name === "zIndex" || name === "fontWeight";
const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// ── Detectors ─────────────────────────────────────────────────────────────────────────────────────────────────

function* matches(re, text) {
  re.lastIndex = 0;
  for (let m; (m = re.exec(text)); ) {
    yield m;
    if (m[0] === "") re.lastIndex++;
  }
}

/** The text between the parenthesis at `open` and its partner. */
function argsAt(text, open) {
  let depth = 0;
  for (let i = open; i < text.length && i < open + 2000; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1, open + 2000);
}

/** Colour literals and hex fallbacks in `text` (offsets as in `text`). `hexText` is where hex values are looked for. */
function colors(text, hexText = text) {
  const out = [];
  const fallbacks = [];
  for (const m of matches(/var\(\s*--[\w-]+\s*,/g, text)) {
    const start = m.index + m[0].length;
    const inner = argsAt(text, m.index + 3);
    const fallback = inner.slice(inner.indexOf(",") + 1);
    const end = m.index + 4 + inner.length;
    HEX.lastIndex = 0;
    COLOR_FN.lastIndex = 0;
    const own = withoutCalls(fallback);
    const named = (own.match(/[a-zA-Z]+/g) ?? []).find((word) => NAMED_COLORS.has(word.toLowerCase()));
    if (HEX.test(own) || COLOR_FN.test(own) || named) {
      out.push({ index: start, rule: "color-fallback", message: `fallback ${fallback.trim()}` });
      fallbacks.push({ start, end });
    }
  }
  const inFallback = (i) => fallbacks.some((f) => i >= f.start && i < f.end);
  for (const m of matches(HEX, hexText)) if (!inFallback(m.index)) out.push({ index: m.index, rule: "color", message: m[0] });
  for (const m of matches(COLOR_FN, text)) if (!inFallback(m.index)) out.push({ index: m.index, rule: "color", message: `${m[0]}…)` });
  return out;
}

/** Declarations in CSS text, outside @font-face (which names a font rather than using one). */
function declarations(text, base = 0) {
  const out = [];
  const faces = [...matches(/@font-face\s*\{[^}]*\}/g, text)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  for (const m of matches(/(?<![\w-])(--[\w-]+|[a-zA-Z-]+)\s*:\s*([^;{}]*)/g, text)) {
    if (faces.some((f) => m.index >= f.start && m.index < f.end)) continue;
    const at = m.index + m[0].length - m[2].length;
    for (const hit of checkDeclaration(m[1], m[2].replace(/!important\s*$/, ""), base + at)) out.push(hit);
  }
  return out;
}

const CLASS_RULES = [
  {
    re: new RegExp(
      `(?<![\\w-])(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|divide|placeholder|caret|accent|decoration|shadow|inset-shadow|inset-ring|drop-shadow)-(?:(?:${PALETTE})-(?:50|[1-9]00|950)|white|black)(?![\\w-])`,
      "g",
    ),
    check: (m) => ({ rule: "palette", message: m[0] }),
  },
  { re: /(?<![\w-])text-\[(\d*\.?\d+)(px|rem|pt)\]/g, check: (m) => problem("font-size", sizeProblem(pixels(m[1], m[2])), m[0]) },
  { re: /(?<![\w-])font-(?:thin|extralight|light|bold|extrabold|black)(?![\w-])/g, check: (m) => ({ rule: "font-weight", message: m[0] }) },
  { re: /(?<![\w-])font-\[(\d+)\]/g, check: (m) => (WEIGHTS.has(m[1]) ? null : { rule: "font-weight", message: m[0] }) },
  { re: /(?<![\w-])font-\[(?!var\(|\d)[^\]]*\]/g, check: (m) => ({ rule: "font-family", message: m[0] }) },
  { re: /(?<![\w-])rounded(?:-[a-z]{1,2})?-\[(?!var\()([^\]]*)\]/g, check: (m) => (/[1-9]\d*(?:\.\d+)?(?:px|rem|em)|0?\.\d*[1-9]\d*(?:px|rem|em)/.test(m[1]) ? { rule: "radius", message: m[0] } : null) },
  { re: /(?<![\w-])-?z-(\d+|\[[^\]]+\])(?![\w-])/g, check: (m) => (/^(?:0|\[0\]|\[auto\])$/.test(m[1]) ? null : { rule: "z-index", message: m[0] }) },
  { re: /(?<![\w-])(?:inset-)?shadow-(?:2xs|xs|sm|md|lg|xl|2xl|inner|\[[^\]]+\])(?![\w-])/g, check: (m) => ({ rule: "shadow", message: m[0] }) },
  { re: /(?<![\w-])(?:inset-)?shadow(?![\w-/:])/g, bare: true, check: (m) => ({ rule: "shadow", message: m[0] }) },
  { re: /(?<![\w-])uppercase(?![\w-])/g, bare: true, check: (m) => ({ rule: "all-caps", message: m[0] }) },
  {
    re: /(?<![\w-])(?:(?:focus|focus-visible|focus-within):(?:ring|outline|shadow)(?:-[\w/.[\]-]+)?|outline-(?:none|hidden|0))(?![\w-])/g,
    check: (m) => ({ rule: "focus-ring", message: m[0] }),
  },
  { re: /(?<![\w-])transition-all(?![\w-])/g, check: (m) => ({ rule: "motion", message: m[0] }) },
  { re: /(?<![\w-])ease-(?:in|out|in-out|linear)(?![\w-])/g, check: (m) => ({ rule: "motion", message: `${m[0]} (an easing of your own)` }) },
  { re: /(?<![\w-])duration-\d+(?![\w-])/g, check: (m) => ({ rule: "motion", message: `${m[0]} (a duration of your own)` }) },
  { re: /(?<![\w-])transition-(?:colors|shadow)(?![\w-])/g, check: (m) => ({ rule: "motion", message: `${m[0]} (only transform and opacity)` }) },
  {
    re: /(?<![\w-])transition-\[([^\]]+)\]/g,
    check: (m) => (m[1].split(",").every((name) => ALLOWED_TRANSITION.has(name.trim()) || name.trim().startsWith("var(")) ? null : { rule: "motion", message: `${m[0]} (only transform and opacity)` }),
  },
  { re: /(?<![\w-:])transition(?![\w-/[])/g, bare: true, check: () => ({ rule: "motion", message: "transition (also animates colours; name transform or opacity)" }) },
];

function problem(rule, message, what) {
  return message ? { rule, message: `${what}: ${message}` } : null;
}

/** Tailwind classes in `text`. `bare` also looks at one-word classes (shadow, uppercase, transition). */
function classes(text, base, bare) {
  const out = [];
  for (const { re, check, bare: needsBare } of CLASS_RULES) {
    if (needsBare && !bare) continue;
    for (const m of matches(re, text)) {
      const hit = check(m);
      if (hit) out.push({ index: base + m.index, ...hit });
    }
  }
  const vars = new RegExp(`--color-(?:(?:${PALETTE})-(?:50|[1-9]00|950)|white|black)(?![\\w-])`, "g");
  for (const m of matches(vars, text)) out.push({ index: base + m.index, rule: "palette", message: m[0] });
  return out;
}

/**
 * A string literal that reads as a class list ("flex shadow-sm uppercase"): two or more words, all lowercase
 * class-like tokens, one of them with a dash or a colon. One word ("shadow") is more often a name, and a sentence
 * ("a smooth transition.") has capitals or punctuation.
 */
function looksLikeClassList(s) {
  const tokens = s.trim().split(/\s+/);
  return tokens.length > 1 && tokens.every((t) => /^!?[a-z0-9[\]():/.%_#,'=&>*-]+$/.test(t) && !/[.,]$/.test(t)) && tokens.some((t) => /[a-z]-|:/.test(t));
}

function scriptChecks(code, strings, stringRanges, raw, component) {
  const out = [];
  out.push(...colors(code, strings));
  for (const { start, end } of stringRanges) {
    const s = raw.slice(start, end);
    const list = looksLikeClassList(s);
    if (list || /^\s*[!a-z0-9[\]():/.%_#,'=&>*-]+\s*$/.test(s)) out.push(...classes(s, start, list));
    if (/[a-z-]+\s*:\s*[^;]+;/.test(s)) out.push(...declarations(s, start));
  }
  for (const m of matches(CAMEL_STYLE, code)) {
    const value = stripQuotes(m[2]);
    if (!numericOk(m[1], m[2], value)) continue;
    out.push(...checkDeclaration(kebab(m[1]), value, m.index + m[0].length - m[2].length));
  }
  for (const m of matches(/\.style\.(\w+)\s*=\s*("[^"\n]*"|'[^'\n]*')/g, code)) out.push(...checkDeclaration(kebab(m[1]), stripQuotes(m[2]), m.index));
  for (const m of matches(/\.(?:fillStyle|strokeStyle|shadowColor)\s*=\s*("[^"\n]*"|'[^'\n]*')/g, code)) out.push(...checkDeclaration("color", stripQuotes(m[1]), m.index));
  for (const m of matches(/\.font\s*=\s*("[^"\n]*"|'[^'\n]*'|`[^`]*`)/g, code)) {
    out.push(...checkDeclaration("font", stripQuotes(m[1]).replace(/\$\{[^}]*\}/g, "var(--x)"), m.index));
  }
  for (const m of matches(/(?<![\w$])document\s*\.\s*(querySelector(?:All)?|getElementById|getElementsByClassName|getElementsByTagName|getElementsByName)\s*(?:<[^<>()]*>\s*)?\(/g, component ? code : "")) {
    out.push({ index: m.index, rule: "dom-query", message: `document.${m[1]}` });
  }
  out.push(...menuAnchors(code));
  for (const m of matches(/\.download\s*=(?!=)|(?<![\w$])showSaveFilePicker\s*\(/g, code)) out.push({ index: m.index, rule: "file-save", message: "a browser download" });
  return out;
}

function menuAnchors(code) {
  const out = [];
  for (const m of matches(/(?<![\w$])showMenu\s*\(/g, code)) {
    const args = argsAt(code, m.index + m[0].length - 1);
    // A wrapper that passes its options on (showMenu(request)) is checked where those are written.
    if (/\b(?:clientX|clientY|pageX|pageY|offsetX|offsetY|screenX|screenY)\b/.test(args)) out.push({ index: m.index, rule: "menu-anchor", message: "showMenu at the pointer" });
    else if (/\{/.test(args) && !/\banchor\b/.test(args)) out.push({ index: m.index, rule: "menu-anchor", message: "showMenu without anchor" });
  }
  return out;
}

const RAW_ELEMENTS = {
  button: "Button",
  select: "Select, Combobox or Picker",
  table: "Table (or DataGrid)",
  details: "Collapsible or Expandable",
  textarea: "Textarea",
  progress: "Progress",
  dialog: "Dialog",
};
const RAW_INPUTS = { range: "Slider or SliderField", checkbox: "Checkbox, Switch or SwitchField", radio: "RadioGroup", color: "ColorPicker" };
const TEXT_INPUTS = new Set(["text", "number", "search", "email", "password", "url", "tel"]);
/** An opening tag's attributes, allowing `>` inside quoted values (`@click="a > b"`). */
const ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`;

function templateChecks(code) {
  const out = [];
  out.push(...colors(code, slotFree(code)));
  for (const m of matches(/<(button|select|table|details|textarea|progress|dialog)(?=[\s>/])/g, code)) {
    out.push({ index: m.index, rule: "kit-control", message: `raw <${m[1]}>: use ${RAW_ELEMENTS[m[1]]}` });
  }
  for (const m of matches(new RegExp(`<input\\b(${ATTRS})>`, "g"), code)) {
    if (/(?:^|\s)(?::|v-bind:)type\s*=/.test(m[1])) continue;
    const type = /(?:^|\s)type\s*=\s*["']?([\w-]+)/.exec(m[1])?.[1]?.toLowerCase() ?? "text";
    const kit = RAW_INPUTS[type] ?? (TEXT_INPUTS.has(type) ? "Input" : null);
    if (kit) out.push({ index: m.index, rule: "kit-control", message: `raw <input type="${type}">: use ${kit}` });
  }
  for (const m of matches(new RegExp(`<Button\\b(?:[^>"']|"[^"]*"|'[^']*')*?\\s:?aria-pressed\\b`, "g"), code)) {
    out.push({ index: m.index, rule: "kit-control", message: "Button with aria-pressed: use Toggle or ToggleGroup" });
  }
  for (const m of matches(new RegExp(`<a\\b(?:[^>"']|"[^"]*"|'[^']*')*?\\s:?download\\b`, "g"), code)) out.push({ index: m.index, rule: "file-save", message: "a download link" });
  for (const m of matches(/(?<=\s)(?::|v-bind:)?(?:[\w-]+-)?class\s*=\s*(?:"([^"]*)"|'([^']*)')/g, code)) {
    const value = m[1] ?? m[2];
    out.push(...classes(value, m.index + m[0].length - value.length - 1, true));
  }
  for (const m of matches(/(?<=\s)style\s*=\s*(?:"([^"]*)"|'([^']*)')/g, code)) {
    const value = m[1] ?? m[2];
    out.push(...declarations(value, m.index + m[0].length - value.length - 1));
  }
  for (const m of matches(/(?<=\s)(?::|v-bind:)style\s*=\s*"([^"]*)"/g, code)) {
    const value = m[1];
    const start = m.index + m[0].length - value.length - 1;
    for (const s of matches(CAMEL_STYLE, value)) {
      const v = stripQuotes(s[2]);
      if (!numericOk(s[1], s[2], v)) continue;
      out.push(...checkDeclaration(kebab(s[1]), v, start + s.index));
    }
  }
  for (const m of matches(/(?<=\s)(fill|stroke|stop-color|flood-color|color)\s*=\s*"([a-zA-Z]+)"/g, code)) {
    if (NAMED_COLORS.has(m[2].toLowerCase())) out.push({ index: m.index, rule: "color", message: `named colour ${m[2]}` });
  }
  for (const m of matches(/(?<![\w$])document\s*\.\s*(querySelector(?:All)?|getElementById)\s*(?:<[^<>()]*>\s*)?\(/g, code)) out.push({ index: m.index, rule: "dom-query", message: `document.${m[1]}` });
  out.push(...menuAnchors(code));
  return out;
}

/** The template without slot shorthands (`<template #default>`), which look like hex colours. */
function slotFree(code) {
  return code.replace(new RegExp(`<template\\b${ATTRS}>`, "g"), (tag) => tag.replace(/(\s)#[\w-]+/g, (s, space) => space + " ".repeat(s.length - 1)));
}

function cssChecks(code) {
  const out = [];
  out.push(...colors(code));
  out.push(...declarations(code));
  for (const m of matches(/@apply\s+([^;}]+)/g, code)) out.push(...classes(m[1], m.index + m[0].length - m[1].length, true));
  const vars = new RegExp(`var\\(\\s*--color-(?:(?:${PALETTE})-(?:50|[1-9]00|950)|white|black)\\b`, "g");
  for (const m of matches(vars, code)) out.push({ index: m.index, rule: "palette", message: m[0].replace(/^var\(\s*/, "") });
  return out;
}

// ── Allow comments ────────────────────────────────────────────────────────────────────────────────────────────

/** Line number (1-based) of each offset. */
function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Reads `rules-allow: <rule>[,<rule>…] <reason>` from a comment. */
export function parseAllow(comment) {
  const body = comment.replace(/^\s*(?:\/\/+|\/\*+|<!--)/, "").replace(/(?:\*\/|-->)\s*$/, "").replace(/^\s*\*\s?/gm, "");
  const m = /rules-allow:\s*([\w-]+(?:\s*,\s*[\w-]+)*)\s*([\s\S]*)$/.exec(body);
  if (!m) return null;
  return { rules: m[1].split(",").map((r) => r.trim()), reason: m[2].trim() };
}

// ── One file, one module ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The breaks in one source file: [{ file, line, rule, message, text }], with allowed ones left out and problems
 * with allow comments added (rule "rules-allow"). `file` is the path shown and kept in the baseline.
 */
export function checkFile(file, text) {
  return analyse(file, text).findings;
}

function analyse(file, text) {
  const lineOf = lineIndex(text);
  const lines = text.split("\n");
  const allowed = new Map();
  const problems = [];
  const raw = [];
  const allComments = [];
  for (const part of regions(file, text)) {
    const lexed = part.kind === "script" ? lexScript(part.text) : part.kind === "css" ? lexCss(part.text) : lexTemplate(part.text);
    allComments.push(...lexed.comments);
    const code = blank(part.text, lexed.comments);
    for (const comment of lexed.comments) {
      const allow = parseAllow(part.text.slice(comment.start, comment.end));
      if (!allow) continue;
      const first = lineOf(comment.start);
      const last = lineOf(Math.max(comment.start, comment.end - 1));
      const unknown = allow.rules.filter((rule) => !(rule in RULES));
      if (unknown.length) problems.push({ line: first, message: `unknown rule ${unknown.join(", ")} (rules: ${Object.keys(RULES).join(", ")})` });
      else if (!allow.reason) problems.push({ line: first, message: `say why: rules-allow: ${allow.rules.join(", ")} <reason>` });
      if (unknown.length || !allow.reason) continue;
      const covered = [];
      for (let line = first; line <= last; line++) covered.push(line);
      if (!code.split("\n")[last - 1]?.trim()) covered.push(last + 1);
      for (const line of covered) {
        const set = allowed.get(line) ?? new Set();
        for (const rule of allow.rules) set.add(rule);
        allowed.set(line, set);
      }
    }
    // A page's entry script (overlay.ts, main.ts) finds its root by id; components and composables use refs.
    const component = file.endsWith(".vue") || (/from\s+["']vue["']/.test(code) && !/\bcreateApp\s*\(/.test(code));
    if (part.kind === "script") raw.push(...scriptChecks(code, only(code, lexed.strings), lexed.strings, code, component));
    else if (part.kind === "css") raw.push(...cssChecks(code));
    else raw.push(...templateChecks(code));
  }
  const seen = new Set();
  const findings = [];
  for (const hit of raw.sort((a, b) => a.index - b.index)) {
    const key = `${hit.index}:${hit.rule}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const line = lineOf(hit.index);
    if (allowed.get(line)?.has(hit.rule)) continue;
    findings.push(finding(file, lines, line, hit.rule, hit.message));
  }
  for (const p of problems) findings.push(finding(file, lines, p.line, ALLOW_RULE, p.message));
  return { file, findings, allowed, lines, text, code: blank(text, allComments) };
}

/**
 * A finding. Its `text` is what the baseline knows it by: the line, and when it is the short start of a tag that goes on
 * (`<Button`), the lines after it up to 40 characters, so the key says which tag it is.
 */
function finding(file, lines, line, rule, message) {
  const collapse = (s) => (s ?? "").trim().replace(/\s+/g, " ");
  let text = collapse(lines[line - 1]);
  const openTag = (t) => /<[\w-]+(?:\s[^>]*)?$/.test(t);
  for (let next = line; openTag(text) && text.length < 40 && next < lines.length && next < line + 5; next++) text = `${text} ${collapse(lines[next])}`;
  return { file, line, rule, message, text: text.slice(0, 300) };
}

const DELAY = /(?<![\w$.])(setTimeout|debounce|useDebounceFn|watchDebounced|throttle|useThrottleFn|requestIdleCallback)\s*\(/g;
/** A save inside a timer's arguments: a call to (or a callback named) save…/…Save…/persist/write, or a store write. */
const SAVES = /(?<![\w$])\w*(?:[sS]ave|[pP]ersist|[wW]rite)\w*\s*[(,)]|\.setState\s*\(|storage(?:\.\w+)*\.set\s*\(/;

/**
 * The breaks in one module: every file's, plus the rules about the module as a whole (a delayed save needs an
 * onSuspend flush, panel state is read back, ZoomPane views are flushed, the catalogs are tested).
 * `files`: [{ file, text }] of the module's src, tests included (they only count for checkCatalogs).
 */
export function checkModule(files) {
  const sources = files.filter((f) => !SKIP.test(f.file));
  const tests = files.filter((f) => SKIP.test(f.file) && !f.file.endsWith(".d.ts"));
  const analysed = sources.map((f) => analyse(f.file, f.text));
  const findings = analysed.flatMap((a) => a.findings);
  const all = analysed.map((a) => a.code).join("\n");
  const has = (re) => re.test(all);
  const extra = [];
  const firstIn = (a, re, rule, message, everyMatch = false) => {
    const lineOf = lineIndex(a.text);
    for (const m of matches(re, a.code)) {
      extra.push({ a, line: lineOf(m.index), rule, message: typeof message === "function" ? message(m) : message });
      if (!everyMatch) return;
    }
  };
  const suspend = has(/\bonSuspend\s*\(/);
  const dispose = has(/\bonDispose\s*\(/);
  if (!suspend || !dispose) {
    const missing = [!suspend && "onSuspend", !dispose && "onDispose"].filter(Boolean).join(" and ");
    for (const a of analysed) {
      const code = a.code;
      const lineOf = lineIndex(a.text);
      for (const m of matches(DELAY, code)) {
        const args = argsAt(code, m.index + m[0].length - 1);
        if (SAVES.test(args)) extra.push({ a, line: lineOf(m.index), rule: "suspend-flush", message: `saves after a delay (${m[1]}), but the module has no ${missing}` });
      }
    }
  }
  const persists = /(?<=\s):?persist-key\s*=|(?<![\w$])persistKey\s*:/g;
  if (has(new RegExp(persists.source)) && !has(/\bflushViewMemory\s*\(/)) {
    for (const a of analysed) firstIn(a, persists, "view-flush", "a ZoomPane or TileMap keeps its view, but flushViewMemory() is never called");
  }
  // openItems / useItemSession read it back for the module and hand it to their `restore`.
  const readsState = has(/\bpanel\s*\.\s*getState\b/) || (has(/\b(?:openItems|useItemSession)\s*[<(]/) && has(/\brestore\s*[:(]/));
  if (has(/\bpanel\s*\.\s*setState\s*\(/) && !readsState) {
    for (const a of analysed) firstIn(a, /\bpanel\s*\.\s*setState\s*\(/g, "panel-state-read", "panel state is written but never read back", true);
  }
  if (has(/\b(?:connectModule|bootstrapModule)\s*\(/) && !tests.some((t) => /\bcheckCatalogs\s*\(/.test(t.text))) {
    for (const a of analysed) firstIn(a, /\b(?:connectModule|bootstrapModule)\s*\(/g, "catalogs", "no test runs checkCatalogs on the texts");
  }
  for (const { a, line, rule, message } of extra) {
    if (a.allowed.get(line)?.has(rule)) continue;
    findings.push(finding(a.file, a.lines, line, rule, message));
  }
  return findings.sort((x, y) => (x.file === y.file ? x.line - y.line : x.file < y.file ? -1 : 1));
}


// ── Modules on disk ───────────────────────────────────────────────────────────────────────────────────────────

const slash = (p) => p.split(path.sep).join("/");

/** The module folders to check, relative to `root`: each folder given, or the modules in it. */
export function findModules(root, folders = []) {
  const asked = folders.length ? folders : [existsSync(path.join(root, "modules")) ? "modules" : "."];
  const found = [];
  for (const folder of asked) {
    const dir = path.resolve(root, folder);
    if (existsSync(path.join(dir, "tavora.module.json"))) found.push(dir);
    else if (existsSync(dir)) {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (entry.isDirectory() && existsSync(path.join(dir, entry.name, "tavora.module.json"))) found.push(path.join(dir, entry.name));
      }
    }
  }
  return [...new Set(found)].map((dir) => slash(path.relative(root, dir)) || ".");
}

function sourceFiles(dir) {
  const out = [];
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SOURCE.test(entry.name)) out.push(full);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/** Every break in the given module folders (relative to `root`). */
export function checkModules(root, modules) {
  return modules.flatMap((module) =>
    checkModule(sourceFiles(path.join(root, module, "src")).map((full) => ({ file: slash(path.relative(root, full)), text: readFileSync(full, "utf8").replace(/\r\n/g, "\n") }))).map((f) => ({ ...f, module })),
  );
}

// ── Baseline ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Splits findings into known (in the baseline) and new. A break is known by its file, rule and the text of its line,
 * not its line number, so a known break that moved stays known and a new one on a moved line is still new. The same
 * text twice counts twice. Also returns how many known breaks are gone, per file, among the files of `modules`.
 */
export function compareBaseline(findings, baseline, modules) {
  const left = new Map();
  for (const [file, rules] of Object.entries(baseline?.files ?? {})) {
    for (const [rule, texts] of Object.entries(rules)) for (const [text, count] of Object.entries(texts)) left.set(key(file, rule, text), count);
  }
  const known = [];
  const fresh = [];
  for (const f of findings) {
    const k = key(f.file, f.rule, f.text);
    const count = left.get(k) ?? 0;
    if (f.rule !== ALLOW_RULE && count > 0) {
      left.set(k, count - 1);
      known.push(f);
    } else fresh.push(f);
  }
  let gone = 0;
  for (const [k, count] of left) if (count > 0 && inModules(k.split("\u0000")[0], modules)) gone += count;
  return { known, fresh, gone };
}

const key = (file, rule, text) => `${file}\u0000${rule}\u0000${text}`;
const inModules = (file, modules) => modules.some((m) => m === "." || file.startsWith(`${m}/`));

/** The baseline after a run over `modules`: their findings replace what it had for them; other modules stay. */
export function updatedBaseline(previous, findings, modules) {
  const files = {};
  for (const [file, rules] of Object.entries(previous?.files ?? {})) if (!inModules(file, modules)) files[file] = rules;
  for (const f of findings) {
    if (f.rule === ALLOW_RULE) continue;
    const texts = ((files[f.file] ??= {})[f.rule] ??= {});
    texts[f.text] = (texts[f.text] ?? 0) + 1;
  }
  return { version: 1, about: "Known breaks of the module rules (tavora docs/module-rules.md). pnpm check:modules fails only on new ones; --update-baseline rewrites this file.", files: sortKeys(files) };
}

function sortKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
}

// ── Command line ──────────────────────────────────────────────────────────────────────────────────────────────

/** Counts per rule and per module. */
export function countFindings(findings) {
  const byRule = {};
  const byModule = {};
  for (const f of findings) {
    byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
    byModule[f.module ?? "?"] = (byModule[f.module ?? "?"] ?? 0) + 1;
  }
  return { byRule: sortKeys(byRule), byModule: sortKeys(byModule) };
}

const show = (f, mark = "") => `${f.file}:${f.line}  ${f.rule}${mark}  ${f.message}. ${RULES[f.rule] ?? "Write it as rules-allow: <rule> <reason>."}`;

/** Runs the check as `pnpm check:modules` does; returns the exit code. */
export function main(argv, { cwd = process.cwd(), log = console.log } = {}) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const folders = argv.filter((a) => !a.startsWith("--"));
  const unknown = [...flags].filter((f) => !["--update-baseline", "--all", "--summary", "--json"].includes(f));
  if (unknown.length) {
    log(`Unknown option ${unknown.join(", ")}. Use: pnpm check:modules [folder…] [--update-baseline] [--all] [--summary] [--json]`);
    return 2;
  }
  const modules = findModules(cwd, folders);
  if (!modules.length) {
    log(`No module folders (with a tavora.module.json) in ${folders.length ? folders.join(", ") : cwd}.`);
    return 2;
  }
  const baselinePath = path.join(cwd, BASELINE_FILE);
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : null;
  const findings = checkModules(cwd, modules);
  if (flags.has("--update-baseline")) {
    writeFileSync(baselinePath, `${JSON.stringify(updatedBaseline(baseline, findings, modules), null, 2)}\n`);
    const kept = findings.filter((f) => f.rule !== ALLOW_RULE);
    log(`${BASELINE_FILE}: ${kept.length} known break${kept.length === 1 ? "" : "s"} in ${modules.length} module${modules.length === 1 ? "" : "s"}.`);
    const problems = findings.filter((f) => f.rule === ALLOW_RULE);
    for (const f of problems) log(show(f));
    return problems.length ? 1 : 0;
  }
  const { known, fresh, gone } = compareBaseline(findings, baseline, modules);
  if (flags.has("--json")) {
    const knownSet = new Set(known);
    log(JSON.stringify({ modules, counts: countFindings(findings), findings: findings.map((f) => ({ ...f, known: knownSet.has(f) })) }, null, 2));
    return fresh.length ? 1 : 0;
  }
  const knownSet = new Set(known);
  for (const f of flags.has("--all") ? findings : fresh) log(show(f, knownSet.has(f) ? " (known)" : ""));
  if (flags.has("--summary")) {
    const { byRule, byModule } = countFindings(findings);
    log("\nBreaks per rule (known and new):");
    for (const [rule, n] of Object.entries(byRule)) log(`  ${rule.padEnd(18)} ${n}`);
    log("Breaks per module:");
    for (const [module, n] of Object.entries(byModule)) log(`  ${module.padEnd(28)} ${n}`);
  }
  const where = `${modules.length} module${modules.length === 1 ? "" : "s"}`;
  if (fresh.length) {
    log(`\n${fresh.length} new break${fresh.length === 1 ? "" : "s"} of the module rules in ${where} (${known.length} known in ${BASELINE_FILE}).`);
    log(`Fix ${fresh.length === 1 ? "it" : "them"} (docs/module-rules.md in tavora), or mark a real exception with \`// rules-allow: <rule> <reason>\` on the line or alone on the line before.`);
  } else log(`Module rules: no new breaks in ${where} (${known.length} known in ${BASELINE_FILE}).`);
  if (gone) log(`${gone} known break${gone === 1 ? " is" : "s are"} fixed; run pnpm check:modules --update-baseline to take ${gone === 1 ? "it" : "them"} out of ${BASELINE_FILE}.`);
  return fresh.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
