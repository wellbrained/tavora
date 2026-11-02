// A small syntax colouring for the code Show code shows: a Vue file with a <script> in TypeScript and a <template>.
// No library: it reads the text once, from left to right, and cuts it into tokens. It only has to colour well enough
// to read; where it doesn't understand something, that text stays plain. Whatever happens, the tokens put back
// together are exactly the source (the unit test checks that for every example), so what is shown is what is copied.

export type TokenKind =
  | "plain"
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "punct"
  /** `{{` and `}}` around an interpolation. */
  | "delim"
  /** An HTML tag name. */
  | "tag"
  /** A component's name (PascalCase). */
  | "component"
  /** An attribute's name, with its `:`, `@`, `v-` or `#` in front. */
  | "attr";

export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "default", "do", "else", "enum", "export", "extends", "false", "finally",
  "for", "from", "function", "if", "implements", "import", "in", "instanceof", "interface", "let", "new", "null", "of", "readonly", "return", "satisfies",
  "switch", "this", "throw", "true", "try", "type", "typeof", "undefined", "var", "void", "while",
]);

const IDENTIFIER = /[A-Za-z_$][\w$]*/y;
const NUMBER = /(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)n?/y;
const TAG_OPEN = /<(\/?)([A-Za-z][\w.:-]*)/y;
const ATTRIBUTE_NAME = /[^\s=>/"']+/y;
const UNQUOTED_VALUE = /[^\s>"'`=<]+/y;
const DIRECTIVE = /^(?::|@|#|v-)/;

class Reader {
  readonly out: Token[] = [];
  constructor(readonly source: string) {}

  push(kind: TokenKind, text: string) {
    if (!text) return;
    const last = this.out[this.out.length - 1];
    // Neighbours of one kind become one token (two strings next to each other stay two, so a string stays a string).
    if (last && last.kind === kind && (kind === "plain" || kind === "punct")) last.text += text;
    else this.out.push({ kind, text });
  }

  match(re: RegExp, at: number): string | undefined {
    re.lastIndex = at;
    const found = re.exec(this.source);
    return found ? found[0] : undefined;
  }

  /** The end of a string that starts at `at` with `quote`: after its closing quote, or the end of the line. */
  stringEnd(at: number, quote: string): number {
    const s = this.source;
    let i = at + 1;
    while (i < s.length && s[i] !== "\n") {
      if (s[i] === "\\") i += 2;
      else if (s[i] === quote) return i + 1;
      else i++;
    }
    return Math.min(i, s.length);
  }

  /**
   * TypeScript from `at` until `stop` is met outside any braces (the text itself is not taken) or the source ends.
   * Returns where it stopped.
   */
  script(at: number, stop: string): number {
    const s = this.source;
    const lowerStop = stop.toLowerCase();
    let i = at;
    let depth = 0;
    let plain = "";
    const flush = () => {
      this.push("plain", plain);
      plain = "";
    };
    while (i < s.length) {
      const c = s[i]!;
      if (stop === "</script") {
        if (s.slice(i, i + stop.length).toLowerCase() === lowerStop) break;
      } else if (depth === 0 && s.startsWith(stop, i)) break;

      if (c === "/" && s[i + 1] === "/") {
        flush();
        let end = s.indexOf("\n", i);
        if (end < 0) end = s.length;
        // A line comment never swallows the closing tag of the block it is in.
        const closing = stop === "</script" ? s.toLowerCase().indexOf(lowerStop, i) : -1;
        if (closing >= 0 && closing < end) end = closing;
        this.push("comment", s.slice(i, end));
        i = end;
      } else if (c === "/" && s[i + 1] === "*") {
        flush();
        const close = s.indexOf("*/", i + 2);
        const end = close < 0 ? s.length : close + 2;
        this.push("comment", s.slice(i, end));
        i = end;
      } else if (c === '"' || c === "'") {
        flush();
        const end = this.stringEnd(i, c);
        this.push("string", s.slice(i, end));
        i = end;
      } else if (c === "`") {
        flush();
        i = this.templateString(i);
      } else if (/[A-Za-z_$]/.test(c)) {
        const word = this.match(IDENTIFIER, i)!;
        // A word after a dot (`el.type`) or before a colon (`{ type: 1 }`) is a property's name, not a keyword.
        if (KEYWORDS.has(word) && s[i - 1] !== "." && s[i + word.length] !== ":") {
          flush();
          this.push("keyword", word);
        } else plain += word;
        i += word.length;
      } else if (/\d/.test(c)) {
        flush();
        const number = this.match(NUMBER, i)!;
        this.push("number", number);
        i += number.length;
      } else if (/[{}()[\];,.:?<>=+\-*/%&|!~^@]/.test(c)) {
        flush();
        if (c === "{") depth++;
        else if (c === "}" && depth > 0) depth--;
        this.push("punct", c);
        i++;
      } else {
        plain += c;
        i++;
      }
    }
    flush();
    return i;
  }

  /** A template literal from its opening backtick, with its `${ }` parts as code. Returns where it ends. */
  templateString(at: number): number {
    const s = this.source;
    let i = at + 1;
    let from = at;
    while (i < s.length) {
      if (s[i] === "\\") i += 2;
      else if (s[i] === "`") {
        this.push("string", s.slice(from, i + 1));
        return i + 1;
      } else if (s[i] === "$" && s[i + 1] === "{") {
        this.push("string", s.slice(from, i));
        this.push("punct", "${");
        i = this.script(i + 2, "}");
        if (s[i] === "}") {
          this.push("punct", "}");
          i++;
        }
        from = i;
      } else i++;
    }
    this.push("string", s.slice(from, s.length));
    return s.length;
  }

  /** The inside of a tag after its name: attributes until the `>` (taken too). Returns where it ends. */
  attributes(at: number): number {
    const s = this.source;
    let i = at;
    while (i < s.length) {
      const c = s[i]!;
      if (/\s/.test(c)) {
        let end = i;
        while (end < s.length && /\s/.test(s[end]!)) end++;
        this.push("plain", s.slice(i, end));
        i = end;
      } else if (c === ">") {
        this.push("punct", ">");
        return i + 1;
      } else if (c === "/" && s[i + 1] === ">") {
        this.push("punct", "/>");
        return i + 2;
      } else if (c === "<") {
        // A tag that was never closed: leave the rest to the text.
        return i;
      } else {
        const name = this.match(ATTRIBUTE_NAME, i);
        if (!name) {
          this.push("plain", c);
          i++;
          continue;
        }
        this.push("attr", name);
        i += name.length;
        if (s[i] !== "=") continue;
        this.push("punct", "=");
        i++;
        const quote = s[i];
        if (quote === '"' || quote === "'") {
          const close = s.indexOf(quote, i + 1);
          const end = close < 0 ? s.length : close;
          if (DIRECTIVE.test(name)) {
            // A bound attribute holds an expression: the quotes are strings, the inside is code.
            this.push("string", quote);
            const stopped = this.script(i + 1, quote);
            if (s[stopped] === quote) {
              this.push("string", quote);
              i = stopped + 1;
            } else i = stopped;
          } else {
            this.push("string", s.slice(i, close < 0 ? end : end + 1));
            i = close < 0 ? end : end + 1;
          }
        } else {
          const value = this.match(UNQUOTED_VALUE, i);
          if (value) {
            this.push("string", value);
            i += value.length;
          }
        }
      }
    }
    return i;
  }

  /** The template part: text, tags with their attributes, `{{ }}` and comments. */
  markup() {
    const s = this.source;
    let i = 0;
    let plain = "";
    const flush = () => {
      this.push("plain", plain);
      plain = "";
    };
    while (i < s.length) {
      if (s.startsWith("<!--", i)) {
        flush();
        const close = s.indexOf("-->", i + 4);
        const end = close < 0 ? s.length : close + 3;
        this.push("comment", s.slice(i, end));
        i = end;
      } else if (s.startsWith("{{", i)) {
        flush();
        this.push("delim", "{{");
        i = this.script(i + 2, "}}");
        if (s.startsWith("}}", i)) {
          this.push("delim", "}}");
          i += 2;
        }
      } else if (s[i] === "<" && this.match(TAG_OPEN, i)) {
        flush();
        TAG_OPEN.lastIndex = i;
        const open = TAG_OPEN.exec(s)!;
        const name = open[2]!;
        this.push("punct", open[1] ? "</" : "<");
        this.push(/^[A-Z]/.test(name) ? "component" : "tag", name);
        i += open[0].length;
        i = this.attributes(i);
        // The inside of <script> is code and the inside of <style> is left plain; both run to their closing tag.
        const lower = name.toLowerCase();
        if (!open[1] && s[i - 1] === ">" && s[i - 2] !== "/" && (lower === "script" || lower === "style")) {
          if (lower === "script") i = this.script(i, "</script");
          else {
            const close = s.toLowerCase().indexOf("</style", i);
            const end = close < 0 ? s.length : close;
            this.push("plain", s.slice(i, end));
            i = end;
          }
        }
      } else {
        plain += s[i];
        i++;
      }
    }
    flush();
  }
}

/** The source cut into tokens. Put back together, the tokens are exactly the source. */
export function tokenize(source: string): Token[] {
  const reader = new Reader(source);
  reader.markup();
  return reader.out;
}

/** How many lines the source has (for the numbers beside it). */
export function lineCount(source: string): number {
  return source.split("\n").length;
}
