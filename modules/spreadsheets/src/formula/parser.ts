// Reads a formula's tokens into a tree, with Excel's order: comparisons, then &, then + and -, then * and /, then ^,
// then a sign, then %. A formula that can't be read gives a tree that is an error, never a throw.
import { tokenize, type RefPoint, type Token } from "./lexer";
import type { ErrorCode } from "./values";

export type Node =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "error"; code: ErrorCode }
  | { kind: "ref"; sheet?: string; a: RefPoint; b?: RefPoint }
  | { kind: "call"; name: string; args: Node[] }
  | { kind: "unary"; op: "-" | "+"; arg: Node }
  | { kind: "percent"; arg: Node }
  | { kind: "binary"; op: string; left: Node; right: Node };

class Unreadable extends Error {}

const PRECEDENCE: Record<string, number> = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };

/** The tree of a formula (without its "="). */
export function parse(source: string): Node {
  return parseTokens(tokenize(source));
}

export function parseTokens(all: readonly Token[]): Node {
  const tokens = all.filter((token) => token.type !== "space");
  let at = 0;
  const peek = () => tokens[at];
  const next = () => tokens[at++];

  function expression(minimum: number): Node {
    let left = unary();
    for (;;) {
      const token = peek();
      if (!token || token.type !== "op" || token.text === "%") break;
      const precedence = PRECEDENCE[token.text];
      if (precedence === undefined || precedence < minimum) break;
      next();
      // ^ is left to right in Excel, like the others.
      const right = expression(precedence + 1);
      left = { kind: "binary", op: token.text, left, right };
    }
    return left;
  }

  function unary(): Node {
    const token = peek();
    if (token?.type === "op" && (token.text === "-" || token.text === "+")) {
      next();
      return { kind: "unary", op: token.text, arg: unary() };
    }
    return postfix(primary());
  }

  function postfix(node: Node): Node {
    let result = node;
    while (peek()?.type === "op" && peek()!.text === "%") {
      next();
      result = { kind: "percent", arg: result };
    }
    return result;
  }

  function primary(): Node {
    const token = next();
    if (!token) throw new Unreadable();
    switch (token.type) {
      case "number":
        return { kind: "number", value: token.value };
      case "string":
        return { kind: "string", value: token.value };
      case "bool":
        return { kind: "bool", value: token.value };
      case "error":
        return { kind: "error", code: token.text.toUpperCase() as ErrorCode };
      case "ref":
        return { kind: "ref", ...(token.sheet !== undefined ? { sheet: token.sheet } : {}), a: token.a, ...(token.b ? { b: token.b } : {}) };
      case "name":
        // A word that is no function, reference or TRUE/FALSE: named ranges aren't there (yet).
        return { kind: "error", code: "#NAME?" };
      case "func": {
        const open = next();
        if (open?.type !== "paren" || open.text !== "(") throw new Unreadable();
        const args: Node[] = [];
        if (peek()?.type === "paren" && peek()!.text === ")") {
          next();
          return { kind: "call", name: token.name, args };
        }
        for (;;) {
          // An empty argument (=IF(A1,,2)) counts as nothing.
          if (peek()?.type === "sep" || (peek()?.type === "paren" && peek()!.text === ")")) args.push({ kind: "string", value: "" });
          else args.push(expression(1));
          const after = next();
          if (after?.type === "sep") continue;
          if (after?.type === "paren" && after.text === ")") break;
          throw new Unreadable();
        }
        return { kind: "call", name: token.name, args };
      }
      case "paren": {
        if (token.text !== "(") throw new Unreadable();
        const inner = expression(1);
        const close = next();
        if (close?.type !== "paren" || close.text !== ")") throw new Unreadable();
        return inner;
      }
      default:
        throw new Unreadable();
    }
  }

  try {
    const node = expression(1);
    if (at < tokens.length) throw new Unreadable();
    return node;
  } catch (error) {
    if (error instanceof Unreadable) return { kind: "error", code: "#NAME?" };
    throw error;
  }
}
