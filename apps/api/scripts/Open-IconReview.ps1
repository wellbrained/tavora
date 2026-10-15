# Opens the private icon review page. The page listens only on 127.0.0.1:4011 of the
# server, so this makes an SSH tunnel to it and opens it in the browser; it asks for the
# admin token (set once with: ssh -t root@100.64.0.1 tavora-api-set-setting admin-token).
# Press Enter in this window when you are done, which closes the tunnel.
$ErrorActionPreference = 'Stop'
$key = 'D:\Server\vpn ssh-key-2026-10-05.key'
$remote = 'root@100.64.0.1'
$tunnel = Start-Process ssh.exe -PassThru -WindowStyle Hidden -ArgumentList @(
  '-i', $key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ExitOnForwardFailure=yes',
  '-N', '-L', '4011:127.0.0.1:4011', $remote
)
try {
  Start-Sleep -Seconds 2
  if ($tunnel.HasExited) { throw 'The tunnel did not start. Is port 4011 already in use on this PC?' }
  Start-Process 'http://127.0.0.1:4011/'
  Read-Host 'The review page is open. Press Enter to close the tunnel'
} finally {
  if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id }
}
