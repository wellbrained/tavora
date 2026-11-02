// The line a group of linked counters shows on stream, written by the user: `{deaths} Death – {sitUps} Situps 💀`.
// In the field the user sees a short camelCase key per counter (`keys`). What is saved uses the counters' ids
// (`{@id}`), so renaming a counter doesn't break the text. Lines written with a counter's full name (`{Sit-ups}`,
// spaces and all) still work when typed. A literal brace is written twice: `{{` and `}}`.

export type Part = { text: string } | { ref: string };
export type TemplateError = "empty" | "unclosed" | "stray" | "unknown";

/** Why a text can't be used. `unknown` names the counter that isn't in the group. */
export type Problem = { error: TemplateError; name?: string };

export type Member = { id: string; name: string };

/** A counter's name as the field shows it: braces would break the text, so they go. */
export const cleanName = (name: string): string => name.replace(/[{}]/g, "").trim();

const NOT_WORD = /[^\p{L}\p{M}\p{N}]+/u;
const isShout = (word: string) => word === word.toUpperCase();
const firstOf = (word: string) => Array.from(word)[0] ?? "";

/** A counter's name as one short camelCase word: "Boss kills" is `bossKills`, "Größe" is `größe`. Only letters and digits stay; nothing left is `counter`. */
export function camelName(name: string): string {
  const [head = "", ...rest] = name.split(NOT_WORD).filter(Boolean);
  // A word in capitals ("HP") goes all lower case; any other keeps its own capitals ("bossKills").
  const first = isShout(head) ? head.toLowerCase() : firstOf(head).toLowerCase() + head.slice(firstOf(head).length);
  const others = rest.map((word) => {
    const body = isShout(word) ? word.toLowerCase() : word;
    return firstOf(body).toUpperCase() + body.slice(firstOf(body).length);
  });
  return [first, ...others].join("") || "counter";
}

/** The key each counter is written with in the field, by id. Counters that come out the same get 2, 3 and so on, in list order. */
export function keys(members: Member[]): Map<string, string> {
  const natural = members.map((member) => camelName(member.name));
  const taken = new Set<string>();
  const firsts = natural.map((key) => {
    const fresh = !taken.has(key.toLowerCase());
    taken.add(key.toLowerCase());
    return fresh;
  });
  return new Map(
    members.map((member, index) => {
      let key = natural[index]!;
      if (!firsts[index]) {
        let count = 2;
        while (taken.has(`${key}${count}`.toLowerCase())) count++;
        key += count;
        taken.add(key.toLowerCase());
      }
      return [member.id, key];
    }),
  );
}

/** Splits a text into plain text and `{references}`. Fails on an unclosed `{` or a lone `}`. */
export function tokenize(source: string): { parts: Part[] } | Problem {
  const parts: Part[] = [];
  let text = "";
  const flush = () => {
    if (text) parts.push({ text });
    text = "";
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (char === "{") {
      if (source[i + 1] === "{") {
        text += "{";
        i++;
        continue;
      }
      const end = source.indexOf("}", i + 1);
      const inner = end < 0 ? source.slice(i + 1) : source.slice(i + 1, end);
      if (end < 0 || inner.includes("{")) return { error: "unclosed" };
      flush();
      parts.push({ ref: inner.trim() });
      i = end;
    } else if (char === "}") {
      if (source[i + 1] !== "}") return { error: "stray" };
      text += "}";
      i++;
    } else text += char;
  }
  flush();
  return { parts };
}

const escape = (text: string) => text.replace(/[{}]/g, (char) => char + char);

/** The text typed in the field (with keys, or with full names as older lines have them) as it is saved (with ids), or what is wrong with it. */
export function compile(source: string, members: Member[]): { ok: true; stored: string } | ({ ok: false } & Problem) {
  if (source.trim() === "") return { ok: false, error: "empty" };
  const tokens = tokenize(source);
  if ("error" in tokens) return { ok: false, ...tokens };
  const written = keys(members);
  let stored = "";
  for (const part of tokens.parts) {
    if ("text" in part) {
      stored += escape(part.text);
      continue;
    }
    const wanted = part.ref.toLowerCase();
    // A key first, so what the field shows always finds the same counter again; then a full name, as lines were written before keys.
    const member = members.find((one) => written.get(one.id)!.toLowerCase() === wanted) ?? members.find((one) => cleanName(one.name).toLowerCase() === wanted);
    if (!member) return { ok: false, error: "unknown", name: part.ref };
    stored += `{@${member.id}}`;
  }
  if (!tokens.parts.length) return { ok: false, error: "empty" };
  return { ok: true, stored };
}

/** Saved text back to the field's form: ids become the counters' current names. An id nobody has shows as `{?}`. */
export function display(stored: string, members: Member[]): string {
  const tokens = tokenize(stored);
  if ("error" in tokens) return stored;
  const written = keys(members);
  return tokens.parts
    .map((part) => {
      if ("text" in part) return escape(part.text);
      const key = part.ref.startsWith("@") ? written.get(part.ref.slice(1)) : undefined;
      return `{${key ?? "?"}}`;
    })
    .join("");
}

/** The text for a group nobody has written one for: `{deaths} Deaths – {sitUps} Sit-ups`. */
export function defaultText(members: Member[]): string {
  const written = keys(members);
  return members.map((member) => `{${written.get(member.id)}} ${escape(cleanName(member.name))}`).join(" – ");
}

/** A run of the line: the user's words, or a value put in for a placeholder (the overlay draws the two in their own styles). */
export type Segment = { text: string; value: boolean };

/**
 * The line to show as runs: saved text with each placeholder's value in. `values` is by the name written in the braces
 * (`time`, `count`) or by counter id for the `{@id}` of a group's counter. Null when the text can't be used (a name nobody has, a broken brace).
 */
export function segments(stored: string, values: ReadonlyMap<string, string>): Segment[] | null {
  const tokens = tokenize(stored);
  if ("error" in tokens || !tokens.parts.length) return null;
  const result: Segment[] = [];
  for (const part of tokens.parts) {
    if ("text" in part) {
      result.push({ text: part.text, value: false });
      continue;
    }
    const value = values.get(part.ref.startsWith("@") ? part.ref.slice(1) : part.ref.toLowerCase());
    if (value === undefined) return null;
    result.push({ text: value, value: true });
  }
  return result;
}

/** The line to show: saved text with each counter's value in. Null when the text can't be used (a counter that is gone, a broken brace). */
export function render(stored: string, values: ReadonlyMap<string, string>): string | null {
  return segments(stored, values)?.map((part) => part.text).join("") ?? null;
}

/** What the words of a line are, without the values. */
export const wordsOf = (line: Segment[]): string => line.filter((part) => !part.value).map((part) => part.text).join("").trim();

// ── The text of one clock or counter ───────────────────────────────────

/** The one placeholder a clock's text has, and a counter's. A group's texts name its counters instead. */
export const TIME = "time";
export const COUNT = "count";

/**
 * The text a clock or counter shows when its owner wrote none: its name before the value, as the overlay always did. Empty without a
 * name. (Before the text field there was a switch, Show the name; this is what its answer was.)
 */
export function legacyText(label: string, showLabel: boolean, name: string): string {
  const words = label.trim();
  return showLabel && words ? `${escape(words)} {${name}}` : `{${name}}`;
}

/**
 * The text written for a clock or counter, as it is saved: only `{name}` is a placeholder there. Empty is fine (the overlay then shows
 * only the value). Names are compared without regard to case and saved in lower case.
 */
export function compileItem(source: string, name: string): { ok: true; stored: string } | ({ ok: false } & Problem) {
  const tokens = tokenize(source);
  if ("error" in tokens) return { ok: false, ...tokens };
  let stored = "";
  for (const part of tokens.parts) {
    if ("text" in part) stored += escape(part.text);
    else if (part.ref.toLowerCase() === name) stored += `{${name}}`;
    else return { ok: false, error: "unknown", name: part.ref };
  }
  return { ok: true, stored };
}

/** Whether the words of a saved text show anything besides the value (the old Show the name switch, kept in step for the version before). */
export function hasWords(stored: string): boolean {
  const tokens = tokenize(stored);
  return "parts" in tokens && tokens.parts.some((part) => "text" in part && part.text.trim() !== "");
}
