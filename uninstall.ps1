<#
.SYNOPSIS
  卸载 Codex 用量管家插件。

.DESCRIPTION
  1. 卸载插件 codex-usage-coach
  2. 移除本地插件市场 lucky-usage
  3. 提示数据目录位置（不自动删除）

.EXAMPLE
  .\uninstall.ps1
  .\uninstall.ps1 -PurgeData
#>
[CmdletBinding()]
param(
  [string]$CodexExe = '',
  [switch]$PurgeData
)

$ErrorActionPreference = 'Continue'
$marketName = 'lucky-usage'
$pluginName = 'codex-usage-coach'

function Find-CodexExe {
  if ($CodexExe) { return $CodexExe }
  if ($env:CODEX_CLI_PATH -and (Test-Path -LiteralPath $env:CODEX_CLI_PATH)) { return $env:CODEX_CLI_PATH }
  $onPath = Get-Command codex.exe -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  foreach ($dir in @((Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'), (Join-Path $env:LOCALAPPDATA 'Programs\Codex\bin'))) {
    if (Test-Path -LiteralPath $dir) {
      $hit = Get-ChildItem -LiteralPath $dir -Filter 'codex.exe' -Recurse -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if ($hit) { return $hit.FullName }
    }
  }
  return $null
}

$codex = Find-CodexExe
if (-not $codex) {
  Write-Host '找不到 codex.exe，请用 -CodexExe 指定。' -ForegroundColor Yellow
  exit 1
}

Write-Host "==> 卸载插件 $pluginName" -ForegroundColor Cyan
& $codex plugin remove $pluginName

Write-Host "==> 移除插件市场 $marketName" -ForegroundColor Cyan
& $codex plugin marketplace remove $marketName

$taskCodexRoot = Join-Path $env:USERPROFILE '.codex'
if ($env:CODEX_HOME) { $taskCodexRoot = $env:CODEX_HOME }
$taskCodexRoot = [IO.Path]::GetFullPath($taskCodexRoot)
$dataDir = [IO.Path]::GetFullPath((Join-Path $taskCodexRoot 'usage-coach'))
if ($PurgeData -and (Test-Path -LiteralPath $dataDir)) {
  if ((Split-Path $dataDir -Parent).TrimEnd('\') -ne $taskCodexRoot.TrimEnd('\') -or (Split-Path $dataDir -Leaf) -ne 'usage-coach') { throw 'Unexpected data cleanup path.' }
  if ((Get-Item -LiteralPath $dataDir).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing recursive cleanup through a link.' }
  Write-Host "==> 删除数据目录 $dataDir" -ForegroundColor Cyan
  Remove-Item -LiteralPath $dataDir -Recurse -Force
} elseif (Test-Path -LiteralPath $dataDir) {
  Write-Host "数据目录保留：$dataDir（加 -PurgeData 可一并删除）" -ForegroundColor Yellow
}

Write-Host '卸载完成。' -ForegroundColor Green
