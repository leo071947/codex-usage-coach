<#
.SYNOPSIS
  安装 Codex 用量管家插件（本地 marketplace + 插件）。

.DESCRIPTION
  1. 把本目录注册成本地插件市场 lucky-usage
  2. 从该市场安装 codex-usage-coach
  3. 打印 codex plugin list 结果

.PARAMETER CodexExe
  codex.exe 的完整路径。默认自动查找：CODEX_CLI_PATH → PATH → Codex 安装目录。

.EXAMPLE
  .\install.ps1
  .\install.ps1 -CodexExe "C:\Users\me\AppData\Local\OpenAI\Codex\bin\xxxx\codex.exe"
#>
[CmdletBinding()]
param(
  [string]$CodexExe = ''
)

$ErrorActionPreference = 'Stop'
$marketName = 'lucky-usage'
$pluginName = 'codex-usage-coach'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step([string]$text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Write-Ok([string]$text) { Write-Host "    $text" -ForegroundColor Green }
function Write-Warn([string]$text) { Write-Host "    $text" -ForegroundColor Yellow }

function Find-CodexExe {
  if ($CodexExe) {
    if (-not (Test-Path -LiteralPath $CodexExe)) { throw "指定的 codex.exe 不存在：$CodexExe" }
    return (Resolve-Path -LiteralPath $CodexExe).Path
  }
  if ($env:CODEX_CLI_PATH -and (Test-Path -LiteralPath $env:CODEX_CLI_PATH)) {
    return (Resolve-Path -LiteralPath $env:CODEX_CLI_PATH).Path
  }
  $onPath = Get-Command codex.exe -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }

  $roots = @(
    (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Codex\bin'),
    (Join-Path ${env:ProgramFiles} 'Codex\bin')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  $found = @()
  foreach ($dir in $roots) {
    $found += Get-ChildItem -LiteralPath $dir -Filter 'codex.exe' -Recurse -ErrorAction SilentlyContinue
  }
  if ($found.Count -gt 0) {
    return ($found | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
  }
  throw "找不到 codex.exe。请用 -CodexExe 指定完整路径，或把 codex 加入 PATH。"
}

if (-not (Test-Path -LiteralPath (Join-Path $root '.agents\plugins\marketplace.json'))) {
  throw "当前目录不像插件市场根目录（缺 .agents\plugins\marketplace.json）：$root"
}

Write-Step "查找 codex.exe"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Install Node.js 18+ and ensure node is available in PATH before installing this cross-platform plugin.'
}
$codex = Find-CodexExe
Write-Ok $codex

Write-Step "注册本地插件市场 $marketName"
& $codex plugin marketplace add $root
if ($LASTEXITCODE -ne 0) {
  Write-Warn "marketplace add 返回 $LASTEXITCODE；如果提示已存在，可继续下一步。"
}

Write-Step "安装插件 $pluginName@$marketName"
& $codex plugin add "$pluginName@$marketName"
if ($LASTEXITCODE -ne 0) {
  throw "安装失败（退出码 $LASTEXITCODE）。可手动执行：`"$codex`" plugin marketplace add `"$root`" 然后 `"$codex`" plugin add $pluginName@$marketName"
}

Write-Step "确认安装结果"
& $codex plugin list

Write-Host ''
Write-Host '完成。用法：' -ForegroundColor Green
Write-Host '  · 在 Codex 里新建对话，直接问「我还剩多少额度 / 今天还能用多少」'
Write-Host '  · 或输入 /usage-coach 触发技能说明'
Write-Host '  · 需要看仪表盘时说「打开用量仪表盘」'
Write-Host ''
Write-Host "数据目录：$env:USERPROFILE\.codex\usage-coach （缓存、报告、仪表盘）"
