// Finds every write of a file in a TypeScript source, for saved-file-rules.test.ts: each call of a writing function of
// the file system (`node:fs`, `fs`, `node:fs/promises`, `fs/promises`) or of Tavora's own (`./fsutil`, `./json`,
// `./rename-held`), however it was imported or renamed, as `api(path)` (`api(from, to)` for a rename, copy or link);
// a file handle's writes as `FileHandle.write(handle)`. A writing function used other than by a call (handed on, kept
// where it can't be followed) is found as `ref api`; a require or dynamic import of these modules as `require module`.
// Renames count as writes: one can put any file in place of the user's.
import path from "node:path";
import ts from "typescript";

const FS_MODULES = new Set(["node:fs", "fs", "node:fs/promises", "fs/promises"]);
const TRACKED = new Set([...FS_MODULES, "./fsutil", "./json", "./rename-held"]);

/** The functions that write, by module: the file system's, then Tavora's own. */
const FS_WRITES = new Set([
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
  "rename",
  "renameSync",
  "truncate",
  "truncateSync",
  "ftruncate",
  "ftruncateSync",
  "write",
  "writeSync",
  "writev",
  "writevSync",
  "symlink",
  "symlinkSync",
  "link",
  "linkSync",
]);
const OWN_WRITES: Record<string, Set<string>> = {
  "./fsutil": new Set(["writeFileAtomic", "writeFileUnlessReplaced", "keepCopy", "keepCopyAt"]),
  "./json": new Set(["setAside", "keepNewerCopy", "readJsonOrSetAside"]),
  "./rename-held": new Set(["renameHeld"]),
};
/** The functions that write to their second path: what they put where. */
const TWO_PATHS = new Set(["rename", "renameSync", "renameHeld", "copyFile", "copyFileSync", "cp", "cpSync", "link", "linkSync", "symlink", "symlinkSync", "keepCopy", "keepCopyAt"]);

/** What a file handle writes with (`await open(…)`). */
const HANDLE_WRITES = new Set(["write", "writeFile", "writev", "appendFile", "truncate", "createWriteStream"]);

/**
 * A module as named from main/: the file system's as they are, one of Tavora's by its path from main/ (`./json`, also
 * when a source in a folder of main/ imports it as `../json`).
 */
function moduleOf(fileName: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  return `./${path.posix.normalize(path.posix.join(path.posix.dirname(fileName), specifier))}`;
}

/** What a name in the source stands for. */
type Binding = { kind: "function"; module: string; name: string } | { kind: "namespace"; module: string } | { kind: "handle" };

const isFs = (module: string) => FS_MODULES.has(module);
const writes = (module: string, name: string) => (isFs(module) ? FS_WRITES.has(name) || name === "open" || name === "openSync" : (OWN_WRITES[module]?.has(name) ?? false));
const label = (binding: Extract<Binding, { kind: "function" }>) => (isFs(binding.module) ? binding.name : `${binding.module.slice(2)}.${binding.name}`);

/** Whether a call of `open` asks to write: a flag with w, a or +, or one that isn't written out (it could be). */
function opensToWrite(call: ts.CallExpression): boolean {
  const flag = call.arguments[1];
  if (!flag) return false;
  if (ts.isStringLiteralLike(flag)) return /[wa+]/.test(flag.text);
  return true;
}

/** The writes of a file in one source, in order. */
export function fileWrites(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const bindings = new Map<string, Binding>();
  const found: string[] = [];
  const short = (node: ts.Node | undefined) => (node ? node.getText(source).replace(/\s+/g, " ").trim() : "");

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = moduleOf(fileName, statement.moduleSpecifier.text);
    if (!TRACKED.has(module)) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) bindings.set(clause.name.text, { kind: "namespace", module });
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) bindings.set(named.name.text, { kind: "namespace", module });
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        const name = (element.propertyName ?? element.name).text;
        // `promises` from fs is the promises module.
        bindings.set(element.name.text, isFs(module) && name === "promises" ? { kind: "namespace", module: "node:fs/promises" } : { kind: "function", module, name });
      }
    }
  }

  /** What an expression stands for: a function or module of the tracked ones, or a file handle. */
  const resolve = (node: ts.Expression): Binding | undefined => {
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isAwaitExpression(node)) node = node.expression;
    if (ts.isIdentifier(node)) return bindings.get(node.text);
    if (ts.isPropertyAccessExpression(node) || (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression))) {
      const owner = resolve(node.expression);
      const name = ts.isPropertyAccessExpression(node) ? node.name.text : (node.argumentExpression as ts.StringLiteralLike).text;
      if (owner?.kind === "namespace") return isFs(owner.module) && name === "promises" ? { kind: "namespace", module: "node:fs/promises" } : { kind: "function", module: owner.module, name };
      if (owner?.kind === "handle" && HANDLE_WRITES.has(name)) return { kind: "function", module: "FileHandle", name };
    }
    if (ts.isCallExpression(node)) {
      const callee = resolve(node.expression);
      if (callee?.kind === "function" && isFs(callee.module) && callee.name === "open") return { kind: "handle" };
    }
    return undefined;
  };

  // Names that take one of these on (`const put = writeFile`, `const { writeFile } = fs`, `const handle = await open(…)`),
  // until no new one turns up.
  for (let changed = true; changed; ) {
    changed = false;
    const visit = (node: ts.Node): void => {
      let target: ts.BindingName | ts.Expression | undefined;
      let value: ts.Expression | undefined;
      if (ts.isVariableDeclaration(node)) [target, value] = [node.name, node.initializer];
      else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) [target, value] = [node.left, node.right];
      if (target && value) {
        const bound = resolve(value);
        if (bound && ts.isIdentifier(target) && !bindings.has(target.text)) {
          bindings.set(target.text, bound);
          changed = true;
        }
        if (bound?.kind === "namespace" && ts.isObjectBindingPattern(target)) {
          for (const element of target.elements) {
            if (!ts.isIdentifier(element.name) || bindings.has(element.name.text)) continue;
            const name = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : element.name.text;
            bindings.set(element.name.text, { kind: "function", module: bound.module, name });
            changed = true;
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // require("fs") or import("fs"): the module is reached past its imports.
      if ((callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && TRACKED.has(moduleOf(fileName, node.arguments[0].text))) {
        found.push(`require ${moduleOf(fileName, node.arguments[0].text)}`);
      }
      const bound = resolve(callee);
      if (bound?.kind === "function") {
        const isOpen = isFs(bound.module) && (bound.name === "open" || bound.name === "openSync");
        if (bound.module === "FileHandle") found.push(`FileHandle.${bound.name}(${short((callee as ts.PropertyAccessExpression).expression)})`);
        else if (writes(bound.module, bound.name) && (!isOpen || opensToWrite(node))) {
          // A rename, copy or link names its target second: both paths are shown.
          const shown = TWO_PATHS.has(bound.name) ? node.arguments.slice(0, 2).map(short).join(", ") : short(node.arguments[0]);
          found.push(`${label(bound)}(${shown})`);
        }
        // The callee itself is accounted for; its arguments are looked at below.
        node.arguments.forEach(visit);
        if (!ts.isIdentifier(callee)) visit((callee as ts.PropertyAccessExpression).expression);
        return;
      }
    }
    // A writing function, or a module of them, used other than by a call or an import.
    if (ts.isIdentifier(node) && !ts.isImportSpecifier(node.parent) && !ts.isImportClause(node.parent) && !ts.isNamespaceImport(node.parent)) {
      const parent = node.parent;
      const declared = (ts.isVariableDeclaration(parent) && parent.name === node) || ts.isBindingElement(parent) || (ts.isPropertyAccessExpression(parent) && parent.name === node) || isNameOrType(node);
      const bound = bindings.get(node.text);
      if (!declared && bound) {
        const usedAsOwner = (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node;
        if (bound.kind === "function" && writes(bound.module, bound.name) && !isAliasDeclaration(node)) found.push(`ref ${label(bound)}`);
        if (bound.kind === "namespace" && !usedAsOwner && !isAliasDeclaration(node)) found.push(`ref ${bound.module}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The name of something declared (a method, a property, a parameter), or a name in a type: no use of the import. */
function isNameOrType(node: ts.Identifier): boolean {
  const parent = node.parent;
  if ((ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent) || ts.isGetAccessor(parent) || ts.isSetAccessor(parent)) && parent.name === node) return true;
  for (let up: ts.Node | undefined = parent; up; up = up.parent) if (ts.isTypeNode(up)) return true;
  return false;
}

/** `const put = writeFile` or `const { writeFile } = fs`: the name it gives is followed, so this use is no escape. */
function isAliasDeclaration(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (ts.isVariableDeclaration(parent) && parent.initializer === node) || (ts.isBinaryExpression(parent) && parent.right === node && ts.isIdentifier(parent.left));
}

/** Every `new SavedFile(…)` in a source, with its kind as written, and whether SavedFile is extended. */
export function savedFileKinds(fileName: string, text: string): { kinds: string[]; extended: boolean } {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || moduleOf(fileName, statement.moduleSpecifier.text) !== "./saved-file") continue;
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) for (const element of named.elements) if ((element.propertyName ?? element.name).text === "SavedFile") names.add(element.name.text);
  }
  if (fileName.endsWith("saved-file.ts")) names.add("SavedFile");
  const kinds: string[] = [];
  let extended = false;
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text)) kinds.push(node.arguments?.[1]?.getText(source).replace(/\s+/g, " ") ?? "");
    if (ts.isHeritageClause(node) && node.types.some((type) => ts.isIdentifier(type.expression) && names.has(type.expression.text))) extended = true;
    // SavedFile used other than by `new` (kept in a variable, handed on) is no SavedFile this check can follow.
    if (ts.isIdentifier(node) && names.has(node.text) && !ts.isImportSpecifier(node.parent) && !(ts.isNewExpression(node.parent) && node.parent.expression === node) && !ts.isTypeReferenceNode(node.parent) && !ts.isClassDeclaration(node.parent) && !ts.isExpressionWithTypeArguments(node.parent) && !ts.isTypeQueryNode(node.parent) && !(ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword)) {
      kinds.push(`ref ${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { kinds, extended };
}
