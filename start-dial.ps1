# Launch the local watch-style floating window without a console window.
$dialScript = Join-Path $PSScriptRoot 'plugins\codex-usage-coach\scripts\dial.ps1'
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$coachDir = Join-Path $env:USERPROFILE '.codex\usage-coach'
if ($env:CODEX_HOME) { $coachDir = Join-Path $env:CODEX_HOME 'usage-coach' }
$windowPidPath = Join-Path $coachDir 'dial-window.pid'
if (Test-Path -LiteralPath $windowPidPath) {
  $windowPid = 0
  if ([int]::TryParse([IO.File]::ReadAllText($windowPidPath).Trim(), [ref]$windowPid)) {
    $oldWindow = Get-Process -Id $windowPid -ErrorAction SilentlyContinue
    $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $windowPid" -ErrorAction SilentlyContinue).CommandLine
    if ($oldWindow -and $oldWindow.ProcessName -eq 'powershell' -and $commandLine -and $commandLine.IndexOf($dialScript,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
      Add-Type -Path (Join-Path $PSScriptRoot 'plugins\codex-usage-coach\scripts\LayeredPetForm.cs') -ReferencedAssemblies System.Windows.Forms,System.Drawing
      [SportDialForm]::RequestClose($windowPid)
      if (-not $oldWindow.WaitForExit(5000)) { throw 'Previous pet did not close; restart cancelled.' }
    }
  }
}
Start-Process -FilePath $psExe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $dialScript + '"'))
