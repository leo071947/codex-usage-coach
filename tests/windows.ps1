$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pluginRoot = Join-Path $projectRoot 'plugins\codex-usage-coach'
$scripts = Join-Path $pluginRoot 'scripts'

# Parse every PowerShell source without executing installers or accessing accounts.
Get-ChildItem -LiteralPath $projectRoot -Filter '*.ps1' -Recurse | ForEach-Object {
  $tokens=$null; $errors=$null
  [void][Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$tokens,[ref]$errors)
  if ($errors.Count -gt 0) { throw ($errors | Out-String) }
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Path (Join-Path $scripts 'LayeredPetForm.cs') -ReferencedAssemblies System.Windows.Forms,System.Drawing
Add-Type -Path (Join-Path $scripts 'PatrolController.cs')
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
$refs=@([Windows.Automation.AutomationElement].Assembly.Location,[Windows.Automation.ControlType].Assembly.Location,[Windows.Rect].Assembly.Location,'System.Core')
Add-Type -Path (Join-Path $scripts 'InputAnchor.cs') -ReferencedAssemblies $refs

$patrol=New-Object PatrolController
$patrol.Advance(0.2,200)
if($patrol.Position -ne 0){throw 'Idle frames must not translate'}
$turned=$false
for($index=0;$index -lt 700;$index++){
  $before=$patrol.Position; $wasWalking=$patrol.IsWalking
  $patrol.Advance((1.0/12),200)
  if($patrol.Position -lt 0 -or $patrol.Position -gt 200){throw 'Patrol escaped its bounds'}
  if(-not $wasWalking -and -not $patrol.IsWalking -and $patrol.Position -ne $before){throw 'Idle frame translated'}
  if($patrol.Direction -lt 0){$turned=$true}
}
if(-not $turned){throw 'Patrol did not turn at the endpoint'}

$tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$previewRoot=[IO.Path]::GetFullPath((Join-Path $tempRoot ('usage-coach-native-'+[Guid]::NewGuid().ToString('N'))))
[IO.Directory]::CreateDirectory($previewRoot)|Out-Null
try {
  $data=Join-Path $previewRoot 'dial.json'
  [IO.File]::WriteAllText($data,'{"data":{"points":1},"account":"Demo","fiveHour":{"remainingPct":70},"weekly":{"remainingPct":40},"today":{"remainingText":"0","usedText":"10K"},"rings":{"today":{"pct":0}}}')
  $shell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $dial=Join-Path $scripts 'dial.ps1'
  foreach($age in @(0,0.1,1.4,2.65,4)) {
    $out=Join-Path $previewRoot ('frame-'+$age+'.png')
    & $shell -NoProfile -STA -ExecutionPolicy Bypass -File $dial -DataPath $data -Language en -BubblePreview -BubbleAge $age -RenderOnly $out
    if($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $out)){throw 'Bubble preview failed'}
  }
  $out=Join-Path $previewRoot 'cat.png'
  & $shell -NoProfile -STA -ExecutionPolicy Bypass -File $dial -DataPath $data -Language zh -RenderOnly $out
  if($LASTEXITCODE -ne 0){throw 'Cat preview failed'}
} finally {
  if(-not $previewRoot.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $previewRoot -Leaf) -notlike 'usage-coach-native-*'){throw 'Unsafe test cleanup path'}
  Remove-Item -LiteralPath $previewRoot -Recurse -Force
}
Write-Output 'PowerShell parsing, native compilation, patrol timeline, and offline rendering passed.'
