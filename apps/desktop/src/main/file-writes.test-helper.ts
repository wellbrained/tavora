// Finds the writes of files in main/'s sources, for saved-file-rules.test.ts. It is a guard against our own mistakes
// (a store that writes one of the user's files by hand, past SavedFile), not a wall against code written to slip by it.
//
// What it covers, read with TypeScript's own parser, source by source and across them:
// - every call of a writing function of the file system (`node:fs`, `fs`, `node:fs/promises`, `fs/promises`):
//   writes, appends, `open` with a flag that writes (or one it can't read), truncates, copies, links, renames,
//   `createWriteStream` and `new WriteStream`, and what a file handle from `open` writes;
// - every call of a function of main/ that writes, found by itself: an exported function whose body writes, or calls
//   one that does (fsutil.ts writeFileAtomic, json.ts setAside, rename-held.ts renameHeld, a store's `saveX(file, …)`),
//   so a new wrapper is followed too;
// - however those are reached: renamed imports, a module imported whole or by default, `promises`, plain
//   destructuring, a name given one of them with `=`, a module in a folder of main/;
// - shown as `api(path)`, `api(from, to)` for a rename, copy or link, `FileHandle.write(handle)` for a handle.
//
// Found as a write of its own, so it fails unless listed: a writing function used other than by a call (`ref api`:
// handed on, or taken with `??`, `||`, a comma, a computed key or destructuring that isn't by plain name), one
// exported again (`export api`), `require` or `import()` of these modules, and `createRequire` or `original-fs` at all.
// Not covered, though the write itself is still listed where it is made: what a class's methods write (a store's own,
// behind its SavedFile), a writer of main/ handed on by reference (`files.map(saveOne)`), one built by a call
// (`throttle((file) => writeFileAtomic(file, …))`), and code built to hide a write.
import path from "node:path";
import ts from "typescript";

const FS_MODULES = new Set(["node:fs", "fs", "node:fs/promises", "fs/promises"]);
/** Ways around the imports this guard follows: refused by name. */
const REFUSED_MODULES = new Set(["original-fs", "node:original-fs"]);

/** The file system's functions that write. */
const FS_WRITES = new Set([
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "WriteStream",
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
/** The functions that write to their second path: what they put where. */
const TWO_PATHS = new Set(["rename", "renameSync", "renameHeld", "copyFile", "copyFileSync", "cp", "cpSync", "link", "linkSync", "symlink", "symlinkSync", "keepCopy", "keepCopyAt"]);
/** What a file handle writes with (`await open(…)`). */
const HANDLE_WRITES = new Set(["write", "writeFile", "writev", "appendFile", "truncate", "createWriteStream"]);

/** What a name in a source stands for. */
type Binding = { kind: "function"; module: string; name: string } | { kind: "namespace"; module: string } | { kind: "handle" };

/** The functions of main/ that write, by module (`./json`): found by fileWrites, source after source. */
type Writers = Map<string, Set<string>>;

const isFs = (module: string) => FS_MODULES.has(module);

/**
 * A module as named from main/: the file system's as they are, one of Tavora's by its path from main/ (`./json`, also
 * when a source in a folder of main/ imports it as `../json`).
 */
function moduleOf(fileName: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  return `./${path.posix.normalize(path.posix.join(path.posix.dirname(fileName), specifier)).replace(/\.tsx?$/, "")}`;
}

/** The module a source is, as others import it. */
const selfOf = (fileName: string) => `./${fileName.replace(/\.tsx?$/, "")}`;

/** Whether a call of `open` asks to write: a flag with w, a or +, or one that isn't written out (it could be). */
function opensToWrite(call: ts.CallExpression): boolean {
  const flag = call.arguments[1];
  if (!flag) return false;
  if (ts.isStringLiteralLike(flag)) return /[wa+]/.test(flag.text);
  return true;
}

/** The name of something declared (a method, a property, a parameter), or a name in a type: no use of the import. */
function isNameOrType(node: ts.Identifier): boolean {
  const parent = node.parent;
  if ((ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent) || ts.isGetAccessor(parent) || ts.isSetAccessor(parent)) && parent.name === node) return true;
  for (let up: ts.Node | undefined = parent; up; up = up.parent) if (ts.isTypeNode(up)) return true;
  return false;
}

/** `const put = writeFile` or `put = writeFile`: the name it gives is followed, so this use is no escape. */
function isAliasDeclaration(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isIdentifier(parent.name)) || (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === node && ts.isIdentifier(parent.left));
}

const hasExport = (node: ts.Node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

/** One source's writes, in order, and the names it exports that write. */
function analyze(fileName: string, source: ts.SourceFile, writers: Writers): { found: string[]; exported: Set<string> } {
  const bindings = new Map<string, Binding>();
  const found: { at: number; text: string }[] = [];
  const add = (node: ts.Node, text: string) => found.push({ at: node.getStart(source), text });
  const short = (node: ts.Node | undefined) => {
    if (!node) return "";
    // What a call is given as a whole object or function says nothing about where it writes.
    if (ts.isObjectLiteralExpression(node)) return "{…}";
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return "() => …";
    return node.getText(source).replace(/\s+/g, " ").trim();
  };
  const writes = (module: string, name: string) => (isFs(module) ? FS_WRITES.has(name) || name === "open" || name === "openSync" : (writers.get(module)?.has(name) ?? false));
  const tracked = (module: string) => isFs(module) || (writers.get(module)?.size ?? 0) > 0;
  const label = (binding: Extract<Binding, { kind: "function" }>) => (isFs(binding.module) ? binding.name : `${binding.module.slice(2)}.${binding.name}`);

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = moduleOf(fileName, statement.moduleSpecifier.text);
    if (REFUSED_MODULES.has(module)) add(statement, `refused ${module}`);
    if (ts.isExportDeclaration(statement)) {
      // Writers exported again: their callers would be past this guard.
      if (!tracked(module)) continue;
      const clause = statement.exportClause;
      if (!clause || ts.isNamespaceExport(clause)) add(statement, `export * from ${module}`);
      else for (const element of clause.elements) if (writes(module, (element.propertyName ?? element.name).text)) add(element, `export ${label({ kind: "function", module, name: (element.propertyName ?? element.name).text })}`);
      continue;
    }
    const clause = statement.importClause;
    if (!clause) continue;
    const named = clause.namedBindings;
    if ((module === "module" || module === "node:module") && named && ts.isNamedImports(named) && named.elements.some((element) => (element.propertyName ?? element.name).text === "createRequire")) add(statement, "refused createRequire");
    if (!tracked(module)) continue;
    if (clause.name) bindings.set(clause.name.text, { kind: "namespace", module });
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

  // Names given one of these with `=` (`const put = writeFile`, `const { writeFile } = fs`, `const handle = await
  // open(…)`), until no new one turns up. Destructuring a module other than by plain name can't be followed: a ref.
  const refsSeen = new Set<ts.Node>();
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
        if (bound?.kind === "namespace" && (ts.isObjectBindingPattern(target) || ts.isArrayBindingPattern(target) || ts.isObjectLiteralExpression(target) || ts.isArrayLiteralExpression(target))) {
          const elements = ts.isObjectBindingPattern(target) ? target.elements : [];
          const plain = ts.isObjectBindingPattern(target);
          for (const element of elements) {
            const key = element.propertyName ?? element.name;
            if (!plain || element.dotDotDotToken || !ts.isIdentifier(element.name) || !ts.isIdentifier(key)) {
              if (!refsSeen.has(element)) {
                refsSeen.add(element);
                add(element, `ref ${bound.module}`);
              }
              continue;
            }
            if (bindings.has(element.name.text)) continue;
            bindings.set(element.name.text, isFs(bound.module) && key.text === "promises" ? { kind: "namespace", module: "node:fs/promises" } : { kind: "function", module: bound.module, name: key.text });
            changed = true;
          }
          if (!plain && !refsSeen.has(target)) {
            refsSeen.add(target);
            add(target, `ref ${bound.module}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  /** The top-level functions of the source, by name, and which of them are exported (by the name they go out as). */
  const functions = new Map<string, ts.Node>();
  const exportedAs = new Map<string, string>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement);
      if (hasExport(statement)) exportedAs.set(statement.name.text, statement.name.text);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const init = declaration.initializer;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) functions.set(declaration.name.text, declaration);
        if (!hasExport(statement)) continue;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) exportedAs.set(declaration.name.text, declaration.name.text);
        // A writer exported under a name of its own: its callers would be past this guard.
        const bound = resolve(init);
        if (bound?.kind === "function" && writes(bound.module, bound.name)) add(declaration, `export ${declaration.name.text} = ${label(bound)}`);
        if (bound?.kind === "namespace") add(declaration, `export ${declaration.name.text} = ${bound.module}`);
      }
    }
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) exportedAs.set((element.propertyName ?? element.name).text, element.name.text);
    }
  }

  /** Calls of the source's own top-level functions, by where they are, to tell which of them write. */
  const localCalls: { at: number; name: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression;
      const args = node.arguments ?? ts.factory.createNodeArray<ts.Expression>();
      // require("fs") or import("fs"): the module is reached past its imports.
      if (ts.isCallExpression(node) && (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) && args[0] && ts.isStringLiteralLike(args[0])) {
        const module = moduleOf(fileName, args[0].text);
        if (tracked(module) || REFUSED_MODULES.has(module)) add(node, `require ${module}`);
      }
      if (ts.isIdentifier(callee) && functions.has(callee.text) && !bindings.has(callee.text)) localCalls.push({ at: node.getStart(source), name: callee.text });
      const bound = resolve(callee);
      if (bound?.kind === "function") {
        const isOpen = isFs(bound.module) && (bound.name === "open" || bound.name === "openSync");
        const newed = ts.isNewExpression(node);
        if (bound.module === "FileHandle") add(node, `FileHandle.${bound.name}(${short((callee as ts.PropertyAccessExpression).expression)})`);
        else if (writes(bound.module, bound.name) && (!isOpen || (ts.isCallExpression(node) && opensToWrite(node)))) {
          // A rename, copy or link names its target second: both paths are shown.
          const shown = TWO_PATHS.has(bound.name) ? args.slice(0, 2).map(short).join(", ") : short(args[0]);
          add(node, `${newed ? "new " : ""}${label(bound)}(${shown})`);
        }
        // The callee itself is accounted for; its arguments are looked at below.
        args.forEach(visit);
        if (!ts.isIdentifier(callee)) visit((callee as ts.PropertyAccessExpression).expression);
        return;
      }
    }
    // A writing function, or a module of them, used other than by a call or an import.
    if (ts.isIdentifier(node) && !ts.isImportSpecifier(node.parent) && !ts.isImportClause(node.parent) && !ts.isNamespaceImport(node.parent) && !ts.isExportSpecifier(node.parent)) {
      const parent = node.parent;
      const declared = (ts.isVariableDeclaration(parent) && parent.name === node) || ts.isBindingElement(parent) || (ts.isPropertyAccessExpression(parent) && parent.name === node) || isNameOrType(node);
      const bound = bindings.get(node.text);
      if (!declared && bound) {
        // Only `module.name` and `module["name"]` are followed; a computed key isn't.
        const usedAsOwner = (ts.isPropertyAccessExpression(parent) && parent.expression === node) || (ts.isElementAccessExpression(parent) && parent.expression === node && ts.isStringLiteralLike(parent.argumentExpression));
        const destructured = ts.isVariableDeclaration(parent) && parent.initializer === node && !ts.isIdentifier(parent.name);
        if (bound.kind === "function" && writes(bound.module, bound.name) && !isAliasDeclaration(node)) add(node, `ref ${label(bound)}`);
        if (bound.kind === "namespace" && !usedAsOwner && !isAliasDeclaration(node) && !destructured) add(node, `ref ${bound.module}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  // Which top-level functions write: one with a write in it, or a call of one that does.
  const writing = new Set<string>();
  const within = (name: string, at: number) => {
    const node = functions.get(name)!;
    return at >= node.getStart(source) && at < node.getEnd();
  };
  for (const [name] of functions) if (found.some(({ at }) => within(name, at))) writing.add(name);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name] of functions) {
      if (writing.has(name)) continue;
      if (localCalls.some((call) => writing.has(call.name) && call.name !== name && within(name, call.at))) {
        writing.add(name);
        changed = true;
      }
    }
  }
  const exported = new Set<string>();
  for (const [local, as] of exportedAs) if (writing.has(local)) exported.add(as);
  // A writer exported under a name of its own (`export const put = writeFile`) writes too.
  for (const { text } of found) {
    const alias = /^export ([\w$]+) = /.exec(text);
    if (alias) exported.add(alias[1]!);
  }
  return { found: found.sort((a, b) => a.at - b.at).map(({ text }) => text), exported };
}

/**
 * The writes of files in every source given (by its path under main/, with `/`): each source's, in order. The
 * functions of main/ that write are found first, by going over the sources again until no new one turns up.
 */
export function fileWrites(sources: ReadonlyMap<string, string>): Map<string, string[]> {
  const parsed = new Map([...sources].map(([name, text]) => [name, ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)]));
  // The modules each source imports or exports from, or loads with import() or require(), to look at it again only
  // when one of them gained a writer.
  const imports = new Map([...parsed].map(([name, source]) => [name, modulesReached(name, source)]));
  const writers: Writers = new Map();
  const result = new Map<string, string[]>();
  let grew: Set<string> | null = null;
  while (grew === null || grew.size > 0) {
    const looked: Set<string> | null = grew;
    grew = new Set<string>();
    for (const [name, source] of parsed) {
      if (looked && ![...imports.get(name)!].some((module) => looked.has(module))) continue;
      const { found, exported } = analyze(name, source, writers);
      result.set(name, found);
      const self = selfOf(name);
      const known = writers.get(self) ?? new Set<string>();
      for (const writer of exported) {
        if (known.has(writer)) continue;
        known.add(writer);
        grew.add(self);
      }
      writers.set(self, known);
    }
  }
  return result;
}

/** The modules a source imports or exports from, and those it loads with `import()` or `require()`, by their name from main/. */
function modulesReached(fileName: string, source: ts.SourceFile): Set<string> {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) found.add(moduleOf(fileName, node.moduleSpecifier.text));
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      found.add(moduleOf(fileName, node.arguments[0].text));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
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
  if (fileName === "saved-file.ts") names.add("SavedFile");
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
