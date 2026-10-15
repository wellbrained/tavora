# Opens the private icon review page. The page listens only on 127.0.0.1:4011 of the
# server, so this makes an SSH tunnel to it and opens it in the browser; it asks for the
# admin token (made on the server with: tavora-api-set-setting admin-token; this PC keeps it in
# D:\Server\tavora-icon-admin-token.txt and this script puts it on the clipboard).
# Press Enter in this window when you are done, which closes the tunnel.
$ErrorActionPreference = 'Stop'
# Start-Process does not quote an argument with a space in it, so the key path is quoted by hand.
$key = 'D:\Server\vpn ssh-key-2026-10-05.key'
$remote = 'root@100.64.0.1'
$tunnel = Start-Process ssh.exe -PassThru -WindowStyle Hidden -ArgumentList @(
  '-i', "`"$key`"", '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ExitOnForwardFailure=yes',
  '-N', '-L', '4011:127.0.0.1:4011', $remote
)
try {
  Start-Sleep -Seconds 2
  if ($tunnel.HasExited) { throw 'The tunnel did not start. Is port 4011 already in use on this PC?' }
  # The page asks for the token once per browser session; it is saved on this PC, so put it on the clipboard.
  $tokenFile = 'D:\Server\tavora-icon-admin-token.txt'
  if (Test-Path $tokenFile) { (Get-Content $tokenFile -Raw).Trim() | Set-Clipboard; Write-Host 'The admin token is on the clipboard: paste it when the page asks.' }
  Start-Process 'http://127.0.0.1:4011/'
  Read-Host 'The review page is open. Press Enter to close the tunnel'
} finally {
  if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id }
}
