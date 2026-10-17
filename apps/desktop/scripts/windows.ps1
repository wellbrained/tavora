# Lists the visible top-level windows of the processes with the given name, one line each:
#   <pid>`t<class>`t<title>
# Used by start-check.mjs. Process.MainWindowTitle picks one window per process and on CI
# picked one with an empty title while Tavora's window was up, so every window is listed.
param([string]$Name = 'Tavora')
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class TavoraWindows {
  delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder text, int max);
  public static List<string> List(HashSet<uint> pids) {
    var lines = new List<string>();
    EnumWindows((hWnd, _) => {
      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      if (pids.Contains(pid) && IsWindowVisible(hWnd)) {
        var title = new StringBuilder(256); GetWindowText(hWnd, title, 256);
        var cls = new StringBuilder(256); GetClassName(hWnd, cls, 256);
        lines.Add(pid + "\t" + cls + "\t" + title);
      }
      return true;
    }, IntPtr.Zero);
    return lines;
  }
}
'@
$pids = [System.Collections.Generic.HashSet[uint32]]::new()
Get-Process $Name -ErrorAction SilentlyContinue | ForEach-Object { [void]$pids.Add([uint32]$_.Id) }
[TavoraWindows]::List($pids)
