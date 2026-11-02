import { describe, expect, it } from "vitest";
import { lineCount, tokenize, type TokenKind } from "./highlight";

const join = (source: string) =>
  tokenize(source)
    .map((token) => token.text)
    .join("");
/** The text of every token of one kind, in order. */
const of = (source: string, kind: TokenKind) =>
  tokenize(source)
    .filter((token) => token.kind === kind)
    .map((token) => token.text);

describe("tokenize", () => {
  it("puts back every example exactly as it was", () => {
    const sources = import.meta.glob<string>("../examples/*/*.vue", { eager: true, query: "?raw", import: "default" });
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    for (const [path, source] of Object.entries(sources)) expect(join(source), path).toBe(source);
  });

  it("puts back any text, however broken", () => {
    const pieces = ["<", ">", "</", "/>", "<!--", "-->", "{{", "}}", "{", "}", "${", "`", '"', "'", "\\", "//", "/*", "*/", "=", ":", "@", "v-", "<script>", "</script>", "<style>", "</style>", "\n", " ", "a", "Button", "const", "1.5", "é", "\r\n"];
    let seed = 12345;
    const next = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    for (let round = 0; round < 600; round++) {
      let source = "";
      for (let i = next(40); i >= 0; i--) source += pieces[next(pieces.length)];
      expect(join(source), JSON.stringify(source)).toBe(source);
    }
  });

  it("colours the script: keywords, strings, numbers, comments and punctuation", () => {
    const source = `<script setup lang="ts">
// the first one
import { ref } from "vue"; /* more */
const count = ref(42); // done
export type Id = string;
</script>`;
    expect(of(source, "keyword")).toEqual(["import", "from", "const", "export", "type"]);
    expect(of(source, "string")).toContain('"vue"');
    expect(of(source, "number")).toEqual(["42"]);
    expect(of(source, "comment")).toEqual(["// the first one", "/* more */", "// done"]);
    // Punctuation next to punctuation is one token (`);`), so look at all of it together.
    for (const mark of ["{", "}", ";", "(", ")", "="]) expect(of(source, "punct").join(""), mark).toContain(mark);
    // Words inside strings and comments are not keywords, and a property named like a keyword isn't one either.
    expect(of('<script>\nconst a = "import from"; // const\nel.type = { type: 1 };\n</script>', "keyword")).toEqual(["const"]);
  });

  it("colours the template: tags, components, attributes, strings, interpolation and comments", () => {
    const source = `<template>
  <!-- a note -->
  <div class="flex gap-2" :title="label" @click="open(1)" v-if="ok">
    <Button variant="ghost" disabled>{{ count + 1 }} items</Button>
  </div>
</template>`;
    expect(of(source, "tag")).toEqual(["template", "div", "div", "template"]);
    expect(of(source, "component")).toEqual(["Button", "Button"]);
    expect(of(source, "attr")).toEqual(["class", ":title", "@click", "v-if", "variant", "disabled"]);
    expect(of(source, "comment")).toEqual(["<!-- a note -->"]);
    expect(of(source, "delim")).toEqual(["{{", "}}"]);
    expect(of(source, "string")).toEqual(expect.arrayContaining(['"flex gap-2"', '"ghost"']));
    // A bound attribute and an interpolation hold code: its number is a number.
    expect(of(source, "number")).toEqual(["1", "1"]);
    // Plain text stays plain.
    expect(tokenize(source).find((token) => token.text.includes(" items"))?.kind).toBe("plain");
  });

  it("reads template strings with code inside, and a tag in a string is only a string", () => {
    const source = "<script>\nconst html = `<div class=\"a\">${count + 1}</div>`;\n</script>";
    expect(of(source, "keyword")).toEqual(["const"]);
    expect(of(source, "number")).toEqual(["1"]);
    expect(of(source, "tag")).toEqual(["script", "script"]);
    expect(of(source, "string").join("")).toBe('`<div class="a"></div>`');
  });

  it("stops the script at its closing tag, even after a comment on the last line", () => {
    const source = "<script>\nlet a = 1; // end</script>\n<template><p>x</p></template>";
    expect(of(source, "comment")).toEqual(["// end"]);
    expect(of(source, "tag")).toEqual(["script", "script", "template", "p", "p", "template"]);
  });

  it("merges neighbours of one kind but never joins two strings", () => {
    expect(of("<script>f();</script>", "punct")).toEqual(["<", ">", "();</", ">"]);
    expect(of('<script>"a" "b"</script>', "string")).toEqual(['"a"', '"b"']);
  });
});

describe("lineCount", () => {
  it("counts lines", () => {
    expect(lineCount("a")).toBe(1);
    expect(lineCount("a\nb\n")).toBe(3);
  });
});
