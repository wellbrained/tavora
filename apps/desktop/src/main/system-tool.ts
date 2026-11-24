import path from "node:path";

/**
 * The full path of one of Windows' own tools (reg, taskkill), so the one in System32 runs (audit run 7): started by its bare
 * name, Windows looks in the current folder first, where someone could have put another.
 */
export function systemTool(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const root = env.SystemRoot ?? env.windir;
  return path.win32.join(root && path.win32.isAbsolute(root) ? root : "C:\\Windows", "System32", `${name}.exe`);
}
