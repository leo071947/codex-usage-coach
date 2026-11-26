# Codex 用量管家 · 悬浮表盘
# 跟随 Codex 输入框的像素猫咪，停步时显示独立上浮的额度气泡。
# 数据来自 ~/.codex/usage-coach/dial.json（由 server/dial-feed.mjs 定期刷新）。
#
# 常用参数：
#   -Interval 30          数据刷新间隔（秒），会传给数据泵
#   -NoFeed               不启动数据泵，只读取已有 dial.json
#   -RenderOnly out.png   只渲染图片（自测用，不开窗）
#   -BubblePreview        渲染额度气泡；加 -Expanded 渲染详情

[CmdletBinding()]
param(
  [string]$DataPath = '',
  [int]$Interval = 30,
  [switch]$NoFeed,
  [string]$RenderOnly = '',
  [switch]$Expanded,
  [string]$PidFile = '',
  [string]$NodeExe = '',
  [ValidateSet('auto', 'zh', 'en')][string]$Language = 'auto',
  [switch]$BubblePreview,
  [double]$BubbleAge = 0.8
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ------------------------------------------------------------------ 主题
$C = @{
  Bg       = [System.Drawing.Color]::FromArgb(255, 16, 18, 21)
  Bg2      = [System.Drawing.Color]::FromArgb(255, 17, 26, 43)
  Border   = [System.Drawing.Color]::FromArgb(255, 43, 48, 53)
  Text     = [System.Drawing.Color]::FromArgb(255, 241, 244, 246)
  Muted    = [System.Drawing.Color]::FromArgb(255, 141, 149, 157)
  Track    = [System.Drawing.Color]::FromArgb(255, 35, 55, 89)
  Weekly   = [System.Drawing.Color]::FromArgb(255, 85, 139, 255)
  Today    = [System.Drawing.Color]::FromArgb(255, 97, 224, 192)
  Budget   = [System.Drawing.Color]::FromArgb(255, 188, 170, 255)
  Warn     = [System.Drawing.Color]::FromArgb(255, 245, 158, 11)
  Bad      = [System.Drawing.Color]::FromArgb(255, 239, 68, 68)
  Good     = [System.Drawing.Color]::FromArgb(255, 34, 197, 94)
}

function New-Font([single]$size, [string]$style = 'Regular') {
  $family = 'Microsoft YaHei UI'
  try {
    $f = New-Object System.Drawing.Font($family, $size, [System.Drawing.FontStyle]::$style, [System.Drawing.GraphicsUnit]::Pixel)
    return $f
  } catch {
    return New-Object System.Drawing.Font('Segoe UI', $size, [System.Drawing.FontStyle]::$style, [System.Drawing.GraphicsUnit]::Pixel)
  }
}

$script:F = @{
  Value   = New-Font 26 'Bold'
  Value2  = New-Font 22 'Bold'
  Title   = New-Font 13 'Bold'
  Body    = New-Font 12.5 'Regular'
  BodyB   = New-Font 12.5 'Bold'
  Small   = New-Font 11 'Regular'
  SmallB  = New-Font 11 'Bold'
  Tiny    = New-Font 10 'Regular'
  Num     = New-Font 17 'Bold'
  RowValue = New-Font 14 'Bold'
}

# ------------------------------------------------------------------ 路径与数据
function Resolve-DataPath {
  if ($DataPath) { return $DataPath }
  $home_ = $env:USERPROFILE
  if ($env:CODEX_HOME) { return (Join-Path $env:CODEX_HOME 'usage-coach\dial.json') }
  return (Join-Path $home_ '.codex\usage-coach\dial.json')
}

function Read-DialJson([string]$path) {
  try {
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
    if (-not $text.Trim()) { return $null }
    return ($text | ConvertFrom-Json)
  } catch {
    return $null
  }
}


# UI language is independent of the feed's language; stored alongside the feed.
$script:uiPath = Join-Path (Split-Path -Parent (Resolve-DataPath)) 'dial-ui.json'
$script:languageChoice = $Language
if ($Language -eq 'auto' -and (Test-Path -LiteralPath $script:uiPath)) {
  try { $saved = Get-Content -LiteralPath $script:uiPath -Raw -Encoding UTF8 | ConvertFrom-Json; if ($saved.language -in @('auto','zh','en')) { $script:languageChoice = $saved.language } } catch { }
}
function Set-UILanguage([string]$choice) {
  $script:languageChoice = $choice
  $script:lang = $choice
  if ($choice -eq 'auto') {
    $script:lang = 'en'
    if ([Globalization.CultureInfo]::CurrentUICulture.Name -like 'zh*') { $script:lang = 'zh' }
  }
}
Set-UILanguage $script:languageChoice
$script:translations = @{
  zh = @{ available='今日可用'; remaining='今日余量'; tokens='TOKENS / 今日可用'; week='周剩'; refresh='立即刷新'; dashboard='打开详细面板'; pause='暂停自动刷新'; resume='继续自动刷新'; quit='退出表盘'; motionOff='关闭动效'; motionOn='开启动效'; language='语言 / Language'; auto='跟随系统 / System'; advice='建议'; updated='更新'; empty='等待数据'; fresh='最新快照'; stale='旧快照 · 推估'; refreshed='已重新读取数据。'; missing='请先在 Codex 中打开用量仪表盘。' }
  en = @{ available='AVAILABLE'; remaining='TODAY REMAINING'; tokens='TOKENS / AVAILABLE'; week='Week'; refresh='Refresh now'; dashboard='Open dashboard'; pause='Pause refresh'; resume='Resume refresh'; quit='Quit dial'; motionOff='Disable animation'; motionOn='Enable animation'; language='Language / 语言'; auto='System / 跟随系统'; advice='Suggestions'; updated='updated'; empty='Waiting for data'; fresh='Fresh snapshot'; stale='Old snapshot · Estimated'; refreshed='Local data reloaded.'; missing='Open the usage dashboard in Codex first.' }
}
function T([string]$key) { return [string]$script:translations[$script:lang][$key] }
function Local-Date($ms) {
  if (-not $ms) { return '—' }
  return [DateTimeOffset]::FromUnixTimeMilliseconds([long]$ms).ToLocalTime().ToString('yyyy-MM-dd HH:mm')
}

function Resolve-NodeExe {
  if ($NodeExe -and (Test-Path -LiteralPath $NodeExe)) { return $NodeExe }
  if ($env:CODEX_MCP_NODE_PATH -and (Test-Path -LiteralPath $env:CODEX_MCP_NODE_PATH)) { return $env:CODEX_MCP_NODE_PATH }
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\runtimes\cua_node\bin\node.exe'),
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
  )
  foreach ($cand in $candidates) {
    if ($cand -and (Test-Path -LiteralPath $cand)) { return $cand }
  }
  $glob = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\runtimes\cua_node') -Filter 'node.exe' -Recurse -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($glob) { return $glob.FullName }
  return $null
}

# ------------------------------------------------------------------ 绘制小工具
function RoundRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc(($x + $w - $d), $y, $d, $d, 270, 90)
  $p.AddArc(($x + $w - $d), ($y + $h - $d), $d, $d, 0, 90)
  $p.AddArc($x, ($y + $h - $d), $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Format-Pct($value) {
  if ($null -eq $value) { return '—' }
  $v = [double]$value
  if ($v -ge 99.95) { return '100%' }
  return ('{0:0.0}%' -f $v)
}

function Draw-Text($g, [string]$text, $font, $color, [single]$x, [single]$y, [single]$w = 0, [string]$align = 'Near') {
  $brush = New-Object System.Drawing.SolidBrush($color)
  if ($w -le 0) {
    $g.DrawString($text, $font, $brush, $x, $y)
  } else {
    $fmt = New-Object System.Drawing.StringFormat
    if ($align -eq 'Center') { $fmt.Alignment = [System.Drawing.StringAlignment]::Center }
    elseif ($align -eq 'Far') { $fmt.Alignment = [System.Drawing.StringAlignment]::Far }
    $g.DrawString($text, $font, $brush, (New-Object System.Drawing.RectangleF($x, $y, $w, 200)), $fmt)
    $fmt.Dispose()
  }
  $brush.Dispose()
}

function Draw-Dot($g, [single]$x, [single]$y, [single]$r, $color) {
  $brush = New-Object System.Drawing.SolidBrush($color)
  $g.FillEllipse($brush, $x, $y, ($r * 2), ($r * 2))
  $brush.Dispose()
}

# ------------------------------------------------------------------ 整体绘制
function Ellipsize($g, [string]$text, $font, [single]$maxWidth) {
  if (-not $text) { return '' }
  if ($g.MeasureString($text, $font).Width -le $maxWidth) { return $text }
  $ell = [char]0x2026
  $chars = $text.ToCharArray()
  for ($n = $chars.Length - 1; $n -gt 0; $n--) {
    $try = (New-Object string ($chars, 0, $n)) + $ell
    if ($g.MeasureString($try, $font).Width -le $maxWidth) { return $try }
  }
  return ''
}

function Draw-TextRight($g, [string]$text, $font, $color, [single]$rightX, [single]$y, [single]$maxWidth) {
  $shown = Ellipsize $g $text $font $maxWidth
  if (-not $shown) { return }
  $wpx = $g.MeasureString($shown, $font).Width
  Draw-Text $g $shown $font $color ($rightX - $wpx) $y
}


Add-Type -Path (Join-Path $PSScriptRoot 'PatrolController.cs')
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
$uiaReferences = @([System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.ControlType].Assembly.Location, [System.Windows.Rect].Assembly.Location, 'System.Core')
Add-Type -Path (Join-Path $PSScriptRoot 'InputAnchor.cs') -ReferencedAssemblies $uiaReferences
$script:inputAnchor = New-Object InputAnchor
$script:lastHostSeen = [DateTime]::UtcNow
$script:lastAnchorStatus = ''
$script:patrolController = New-Object PatrolController
$script:patrol = $true
$script:walkFrames = @()
$walkDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'assets/lv1'
for ($spriteIndex=1; $spriteIndex -le 121; $spriteIndex++) { $script:walkFrames += [Drawing.Image]::FromFile((Join-Path $walkDir ('{0:000}.png' -f $spriteIndex))) }

function Draw-Pet($g, $d) {
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $frameIndex = 0
  if (-not $RenderOnly) { $frameIndex = $script:patrolController.Frame - 1 }
  $image = $script:walkFrames[$frameIndex]
  $dest = New-Object System.Drawing.Rectangle(0, 0, 104, 104)
  if ($script:patrolController.Direction -lt 0) {
    $g.TranslateTransform(104,0); $g.ScaleTransform(-1,1)
    $g.DrawImage($image,$dest,0,0,$image.Width,$image.Height,[Drawing.GraphicsUnit]::Pixel)
    $g.ResetTransform()
  } else { $g.DrawImage($image,$dest,0,0,$image.Width,$image.Height,[Drawing.GraphicsUnit]::Pixel) }
}

# Pixel bubbles share the kitten's purple / cyan jewel palette.
function Draw-PixelPop($g,[single]$cx,[single]$cy,[string]$label,[string]$value,$color,[double]$age,[bool]$animate) {
  if($age -le 0 -and $animate){return}
  $scale=1.0
  if($animate){
    if($age -ge 3.0){return}
    if($age -ge 2.4){
      $p=($age-2.4)/0.6
      for($i=0;$i -lt 9;$i++){
        $angle=($i*40+12)*[Math]::PI/180
        $radius=27+18*$p
        $px=[single]($cx+[Math]::Cos($angle)*$radius)
        $py=[single]($cy+[Math]::Sin($angle)*$radius-3*$p)
        $alpha=[int](240*(1-$p))
        $brush=New-Object Drawing.SolidBrush(([Drawing.Color]::FromArgb($alpha,$color.R,$color.G,$color.B)))
        $sz=[single](4-2*$p)
        $g.FillRectangle($brush,$px,$py,$sz,$sz);$brush.Dispose()
      }
      return
    }
    # Born at the kitten's forehead, rising and growing continuously.
    # There is no hold at full size: reaching scale 1 starts the burst.
    $t=[Math]::Min([double]1,[double]($age/2.4))
    $scale=[Math]::Pow($t,0.85)
    $cx=[single]($script:bubbleOriginX+($cx-$script:bubbleOriginX)*$t)
    $cy=[single](156+($cy-156)*$t)
  }
  if(-not $script:bubbleSprites){$script:bubbleSprites=@{}}
  $key=$label+'|'+$value+'|'+$color.ToArgb()
  if(-not $script:bubbleSprites.ContainsKey($key)){
    if($script:bubbleSprites.Count -ge 12){foreach($old in $script:bubbleSprites.Values){$old.Dispose()};$script:bubbleSprites.Clear()}
    $sprite=New-Object Drawing.Bitmap(288,288,([Drawing.Imaging.PixelFormat]::Format32bppPArgb))
    $target=$g
    $g=[Drawing.Graphics]::FromImage($sprite)
    try {
      $g.Clear([Drawing.Color]::Transparent)
      $g.TextRenderingHint=[Drawing.Text.TextRenderingHint]::AntiAlias
      $g.TranslateTransform(144,144)
      $g.ScaleTransform(4,4)
    $g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::None
    $path=New-Object Drawing.Drawing2D.GraphicsPath
    # Coarse four-pixel stairs match the kitten sprite, with no vector edge.
    $outline=New-Object 'System.Collections.Generic.List[System.Drawing.PointF]'
    for($row=-32;$row -lt 32;$row+=4){
      $middle=$row+2
      $half=[single]([Math]::Floor([Math]::Sqrt(33*33-$middle*$middle)/4)*4)
      $outline.Add((New-Object Drawing.PointF($half,$row)))
      $outline.Add((New-Object Drawing.PointF($half,($row+4))))
    }
    for($row=28;$row -ge -32;$row-=4){
      $middle=$row+1
      $half=[single]([Math]::Floor([Math]::Sqrt(33*33-$middle*$middle)/2)*2)
      $outline.Add((New-Object Drawing.PointF((-$half),($row+2))))
      $outline.Add((New-Object Drawing.PointF((-$half),$row)))
    }
    $path.AddPolygon($outline.ToArray())
    $body=New-Object Drawing.SolidBrush(([Drawing.Color]::FromArgb(225,37,27,55)))
    $g.FillPath($body,$path);$body.Dispose()
    $fraction=0.0
    if($value -ne '—') {
      $numeric=0.0
      if([double]::TryParse($value.TrimEnd('%'),[Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::CurrentCulture,[ref]$numeric)){
        $fraction=[Math]::Max([double]0,[Math]::Min([double]1,[double]($numeric/100)))
      }
    }
    # Remaining quota is encoded by the fill level, clipped to a true circle.
    $clipState=$g.Save();$g.SetClip($path)
    $fillTop=[single]([Math]::Floor((32-64*$fraction)/4)*4)
    if($fraction -gt 0){
      $fill=New-Object Drawing.SolidBrush(([Drawing.Color]::FromArgb(240,[int]($color.R*0.40),[int]($color.G*0.55),[int]($color.B*0.65))))
      # A low-contrast stepped wave replaces the bright straight divider.
      $soft=New-Object Drawing.SolidBrush(([Drawing.Color]::FromArgb(45,[int]($color.R*0.40),[int]($color.G*0.55),[int]($color.B*0.65))))
      $mid=New-Object Drawing.SolidBrush(([Drawing.Color]::FromArgb(110,[int]($color.R*0.40),[int]($color.G*0.55),[int]($color.B*0.65))))
      $near=New-Object Drawing.SolidBrush(([Drawing.Color]::FromArgb(180,[int]($color.R*0.40),[int]($color.G*0.55),[int]($color.B*0.65))))
      if($fraction -ge 0.999){$g.FillRectangle($fill,-34,-34,68,68)}else{
        $wave=@(-4,-4,0,0,4,4,0,0)
        for($column=0;$column -lt 18;$column++){
          $px=[single](-36+$column*4)
          $edgeY=[single]($fillTop+$wave[$column%8])
          $g.FillRectangle($soft,$px,([single]($edgeY-4)),[single]4,[single]4)
          $g.FillRectangle($mid,$px,$edgeY,[single]4,[single]4)
          $g.FillRectangle($near,$px,([single]($edgeY+4)),[single]4,[single]4)
          if($edgeY+8 -lt 34){$g.FillRectangle($fill,$px,([single]($edgeY+8)),[single]4,([single](34-$edgeY-8)))}
        }
      }
      $soft.Dispose();$mid.Dispose();$near.Dispose();$fill.Dispose()
    }
    $g.Restore($clipState)
    $rim=New-Object Drawing.Pen($color,3)
    $g.DrawPath($rim,$path);$rim.Dispose();$path.Dispose()
    $shine=New-Object Drawing.SolidBrush(([Drawing.Color]::FromArgb(220,240,228,255)))
    $g.FillRectangle($shine,-16,-28,12,4)
    $g.FillRectangle($shine,-24,-20,4,8)
    $shine.Dispose()
    $font=New-Object Drawing.Font('Consolas',18,[Drawing.FontStyle]::Bold,[Drawing.GraphicsUnit]::Pixel)
    Draw-Text $g $label $script:F.Tiny ([Drawing.Color]::FromArgb(221,211,237)) -31 -15 62 'Center'
    Draw-Text $g $value $font ([Drawing.Color]::FromArgb(247,242,255)) -32 1 64 'Center'
    $font.Dispose()
    } finally {$g.Dispose();$g=$target}
    $script:bubbleSprites[$key]=$sprite
  }
  $sprite=$script:bubbleSprites[$key]
  $saved=$g.Save()
  try {
    $g.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode=[Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $side=[single](72*$scale)
    $dest=New-Object Drawing.RectangleF(([single]($cx-$side/2)),([single]($cy-$side/2)),$side,$side)
    $source=New-Object Drawing.RectangleF(0,0,288,288)
    $g.DrawImage($sprite,$dest,$source,[Drawing.GraphicsUnit]::Pixel)
  } finally {$g.Restore($saved)}
}
function Draw-OrbPair($g,[int]$w,$d) {
  if(-not $script:bubbleOriginX){$script:bubbleOriginX=$w/2}
  $five='—';$week='—'
  if($d.fiveHour -and $null -ne $d.fiveHour.remainingPct){$five=('{0:0.#}%' -f $d.fiveHour.remainingPct)}
  if($d.weekly -and $null -ne $d.weekly.remainingPct){$week=('{0:0.#}%' -f $d.weekly.remainingPct)}
  $first='5 小时';$second='本周'
  if($script:lang -eq 'en'){$first='5 HOURS';$second='WEEK'}
  $age=0.8
  $animate=$false
  if($RenderOnly){$age=$BubbleAge;$animate=-not [bool]$Expanded}
  elseif($script:motionEnabled -and -not $script:detailsOpen){$age=$script:watch.Elapsed.TotalSeconds-$script:popStartedAt;$animate=$true}
  $rightAge=$age
  if($animate){$rightAge-=0.85}
  Draw-PixelPop $g ($w/2-44) 58 $first $five ([Drawing.Color]::FromArgb(107,239,227)) $age $animate
  Draw-PixelPop $g ($w/2+44) 46 $second $week ([Drawing.Color]::FromArgb(224,146,247)) $rightAge $animate
}

function Draw-UsageBubble($g,[int]$w,[int]$h,$d,[bool]$details,[single]$tailX) {
  $g.Clear([Drawing.Color]::Transparent)
  $g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint=[Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  if(-not $details){Draw-OrbPair $g $w $d;return}
  $bg=[Drawing.Color]::FromArgb(250,31,27,42)
  $edge=[Drawing.Color]::FromArgb(96,77,122)
  $accent=[Drawing.Color]::FromArgb(157,236,221)
  $muted=[Drawing.Color]::FromArgb(176,165,191)
  $bodyH=$h-13
  $path=RoundRect 1 1 ($w-2) $bodyH 15
  $brush=New-Object Drawing.SolidBrush($bg)
  $pen=New-Object Drawing.Pen($edge,1)
  $g.FillPath($brush,$path); $g.DrawPath($pen,$path)
  $tailX=[Math]::Max(24,[Math]::Min($w-24,$tailX))
  $points=[Drawing.PointF[]]@((New-Object Drawing.PointF(($tailX-7),($bodyH-1))),(New-Object Drawing.PointF($tailX,($h-2))),(New-Object Drawing.PointF(($tailX+7),($bodyH-1))))
  $g.FillPolygon($brush,$points)
  $g.DrawLine($pen,($tailX-7),$bodyH,$tailX,($h-2));$g.DrawLine($pen,$tailX,($h-2),($tailX+7),$bodyH)
  $brush.Dispose();$pen.Dispose();$path.Dispose()
  $en=$script:lang -eq 'en'
  Draw-OrbPair $g $w $d
  if($details) {
    $rows=@()
    if($en){
      if($d.account){$rows+=,@('Account',$d.account)}
      if($d.today){$rows+=,@('Planned left',($d.today.remainingText+' tokens'))}
      if($d.today){$rows+=,@('Used today',($d.today.usedText+' tokens'))}
      if($d.fiveHour){$rows+=,@('5h reset',(Local-Date $d.fiveHour.resetsAtMs))}
      if($d.weekly){$rows+=,@('Week reset',(Local-Date $d.weekly.resetsAtMs))}
      if($d.snapshot){$rows+=,@('Snapshot',(Local-Date $d.snapshot.at))}
    }else{
      if($d.account){$rows+=,@('关联账号',$d.account)}
      if($d.today){$rows+=,@('今日建议剩余',($d.today.remainingText+' tokens'))}
      if($d.today){$rows+=,@('今日已用',($d.today.usedText+' tokens'))}
      if($d.fiveHour){$rows+=,@('5小时重置',(Local-Date $d.fiveHour.resetsAtMs))}
      if($d.weekly){$rows+=,@('周额度重置',(Local-Date $d.weekly.resetsAtMs))}
      if($d.snapshot){$rows+=,@('快照时间',(Local-Date $d.snapshot.at))}
    }
    $divider=New-Object Drawing.Pen($edge,1)
    $g.DrawLine($divider,16,105,($w-16),105);$divider.Dispose()
    $y=117
    foreach($row in $rows){Draw-Text $g $row[0] $script:F.Small $muted 16 $y;Draw-TextRight $g $row[1] $script:F.Small $C.Text ($w-16) $y ($w-113);$y+=24}
    $hint='建议预算不等于官方额度 · 点击收起';if($en){$hint='Budget is a plan, not a quota · Click to close'}
    Draw-Text $g $hint $script:F.Tiny $muted 16 ($h-38)
  }
}

$script:watch = [Diagnostics.Stopwatch]::StartNew()

# ------------------------------------------------------------------ 只渲染模式（自测）
if ($RenderOnly) {
  $path = Resolve-DataPath
  $data = Read-DialJson $path
  $w = 104
  $h = 120
  
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(255, 10, 16, 27))
  if($BubblePreview){
    $g.Dispose();$bmp.Dispose()
    $w=184;$h=164;if($Expanded){$w=310;$h=304}
    $bmp=New-Object Drawing.Bitmap($w,$h)
    $g=[Drawing.Graphics]::FromImage($bmp)
    Draw-UsageBubble $g $w $h $data ([bool]$Expanded) ($w/2)
  }else{Draw-Pet $g $data}
  $g.Dispose()
  $bmp.Save($RenderOnly, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "rendered: $RenderOnly ($w x $h) data=$(if ($null -ne $data) { 'yes' } else { 'no' })"
  return
}

# ------------------------------------------------------------------ 屏幕/窗口
$script:petMutex = New-Object Threading.Mutex($false, 'Local\CodexUsageCoachPet')
if (-not $script:petMutex.WaitOne(0)) { $script:petMutex.Dispose(); return }
$dataPath = Resolve-DataPath
# 先把 PID 写出去：即使后面建窗口失败，调用方也能知道进程起来了、并且能查到日志
if (-not $PidFile) { $PidFile = Join-Path (Split-Path -Parent $dataPath) 'dial-window.pid' }
try { [IO.File]::WriteAllText($PidFile, [string]$PID) } catch { }
$script:state = Read-DialJson $dataPath
$script:dragging = $false
$script:dragOffset = New-Object System.Drawing.Point(0, 0)
$script:downPoint = New-Object System.Drawing.Point(0, 0)
$script:moved = $false

$COLLAPSED_W = 104
$COLLAPSED_H = 120

function Write-Err([string]$where, $err) {
  try {
    if (-not $script:errLog) { $script:errLog = Join-Path (Split-Path -Parent $script:dataPath) 'dial-error.log' }
    $msg = (Get-Date).ToString('s') + ' [' + $where + '] ' + $err
    [IO.File]::AppendAllText($script:errLog, $msg + "`r`n", (New-Object Text.UTF8Encoding($false)))
  } catch { }
}


try {
Add-Type -Path (Join-Path $PSScriptRoot 'LayeredPetForm.cs') -ReferencedAssemblies System.Windows.Forms,System.Drawing
$form = New-Object SportDialForm
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.TopMost = $false
$form.ShowInTaskbar = $false
$form.BackColor = $C.Bg
$form.Width = $COLLAPSED_W
$form.Height = $COLLAPSED_H
$form.Text = 'Codex 用量表盘'

$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.Left = $wa.Right - $COLLAPSED_W - 24
$form.Top = $wa.Bottom - $COLLAPSED_H - 24

$script:dataPath = $dataPath


function Render-DialWindow {
  if ($form.IsDisposed -or -not $form.IsHandleCreated) { return }
  $bitmap = New-Object System.Drawing.Bitmap($form.Width, $form.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppPArgb))
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    Draw-Pet $graphics $script:state
    $form.Present($bitmap)
  } catch { Write-Err 'alpha-render' $_ }
  finally { $graphics.Dispose(); $bitmap.Dispose() }
}
$form.Add_Shown({ Update-Patrol 0; Render-DialWindow })

# Companion card is a separate owned alpha window, always above the cat.
$script:detailsOpen = $false
$script:popStartedAt = 0.0
$script:previouslyStopped = $false
$infoForm = New-Object SportDialForm
$infoForm.FormBorderStyle = 'None'
$infoForm.ShowInTaskbar = $false
$infoForm.TopMost = $false
$infoForm.StartPosition = 'Manual'
$infoForm.Text = 'Codex Cat Info'
$infoForm.Width = 270
$infoForm.Height = 108
$infoForm.Add_MouseClick({ $script:detailsOpen=$false; $infoForm.Hide() })
function Toggle-PetDetails {
  $script:detailsOpen = -not $script:detailsOpen
  Update-InfoWindow
}
function Update-InfoWindow {
  if (-not $form.Visible -or -not $form.HostIsActive()) { $infoForm.Hide(); return }
  $stopped = -not $script:patrolController.IsWalking -or -not $script:motionEnabled -or $script:hovering
  if($stopped -and -not $script:previouslyStopped -and ($script:watch.Elapsed.TotalSeconds-$script:popStartedAt -gt 3.85 -or -not $script:popHasStarted)){
    $script:popStartedAt=$script:watch.Elapsed.TotalSeconds
    $script:popHasStarted=$true
    $script:flightData=$script:state
    $script:popOffsetLeft=$form.Left-$script:patrolController.HostBounds.Left
    $script:popOffsetTop=$form.Top-$script:patrolController.HostBounds.Top
  }
  $script:previouslyStopped=$stopped
  if (-not $script:detailsOpen -and -not $stopped -and ($script:watch.Elapsed.TotalSeconds-$script:popStartedAt) -gt 3.85) { $infoForm.Hide(); return }
  if(-not $script:detailsOpen -and $script:motionEnabled -and ($script:watch.Elapsed.TotalSeconds-$script:popStartedAt) -gt 3.85){$infoForm.Hide();return}
  $d=$script:state
  if(-not $script:detailsOpen -and $script:flightData){$d=$script:flightData}
  $infoForm.AttachHost($script:patrolController.HostHandle)
  $desiredWidth=184; $desiredHeight=164
  if($script:detailsOpen){$desiredWidth=310;$desiredHeight=304}
  $area=[Windows.Forms.Screen]::FromHandle($script:patrolController.HostHandle).WorkingArea
  if(-not $script:detailsOpen -and $script:popHasStarted){
    # The flight owns its emission point. Never visit the kitten's new position.
    $originLeft=$script:patrolController.HostBounds.Left+$script:popOffsetLeft
    $originTop=$script:patrolController.HostBounds.Top+$script:popOffsetTop
    $desiredTop=[Math]::Max($area.Top,$originTop-$desiredHeight+18)
  }else{
    $originLeft=$form.Left;$originTop=$form.Top
    $desiredTop=[Math]::Max($area.Top,$originTop-$desiredHeight+4)
  }
  $desiredLeft=[int][Math]::Max($area.Left,[Math]::Min($area.Right-$desiredWidth,$originLeft+52-$desiredWidth/2))
  # Commit once, only on change. Intermediate native moves were visible even
  # though the final draw used the correct frozen position.
  if($infoForm.Left -ne $desiredLeft -or $infoForm.Top -ne $desiredTop -or $infoForm.Width -ne $desiredWidth -or $infoForm.Height -ne $desiredHeight){
    $infoForm.SetBounds($desiredLeft,[int]$desiredTop,$desiredWidth,$desiredHeight)
  }
  $renderW=$infoForm.Width*4; $renderH=$infoForm.Height*4
  if(-not $script:infoBuffer -or $script:infoBuffer.Width -ne $renderW -or $script:infoBuffer.Height -ne $renderH){
    if($script:infoBuffer){$script:infoBuffer.Dispose()}
    $script:infoBuffer=New-Object Drawing.Bitmap($renderW,$renderH,([Drawing.Imaging.PixelFormat]::Format32bppPArgb))
  }
  $g=[Drawing.Graphics]::FromImage($script:infoBuffer)
  $g.ScaleTransform(4,4)
  try {
    $tailX=$originLeft+52-$infoForm.Left
    $script:bubbleOriginX=$tailX
    Draw-UsageBubble $g $infoForm.Width $infoForm.Height $d $script:detailsOpen $tailX
    if(-not $infoForm.Visible){$infoForm.Show()}
    $infoForm.PresentDownsampled($script:infoBuffer,$infoForm.Width,$infoForm.Height)
  } catch { Write-Err 'info-card' $_ }
  finally {$g.Dispose()}
}

$form.Add_MouseDown({
    param($s, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
      $script:patrol = $false
      $script:dragging = $true
      $script:moved = $false
      $script:downPoint = [System.Windows.Forms.Cursor]::Position
      $script:dragOffset = New-Object System.Drawing.Point(($script:downPoint.X - $form.Left), ($script:downPoint.Y - $form.Top))
    }
  })

$form.Add_MouseMove({
    param($s, $e)
    if ($script:dragging) {
      $p = [System.Windows.Forms.Cursor]::Position
      $dx = [Math]::Abs($p.X - $script:downPoint.X)
      $dy = [Math]::Abs($p.Y - $script:downPoint.Y)
      if ($dx -gt 3 -or $dy -gt 3) { $script:moved = $true }
      if ($script:moved) {
        $form.Left = $p.X - $script:dragOffset.X
        $form.Top = $p.Y - $script:dragOffset.Y
        Render-DialWindow
      }
    }
  })

$form.Add_MouseUp({
    param($s, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
      $script:dragging = $false
      if (-not $script:moved) {
        $script:patrol = $true
        Toggle-PetDetails
      }
    }
  })

# 右键菜单
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menu.Renderer = New-Object GemMenuRenderer
$menu.ShowImageMargin = $false
$menu.BackColor = [Drawing.Color]::FromArgb(28,23,39)
$menu.ForeColor = [Drawing.Color]::FromArgb(204,239,237)
$menu.Font = New-Font 12
$menu.Padding = New-Object Windows.Forms.Padding(5)
$menuHeader=$menu.Items.Add('NEON CAT  /  USAGE')
$menuHeader.Enabled=$false
[void]$menu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
$miRefresh = $menu.Items.Add((T 'refresh'))
$miDash = $menu.Items.Add((T 'dashboard'))
$miPause = $menu.Items.Add((T 'pause'))
$miQuit = $menu.Items.Add((T 'quit'))

$miRefresh.Add_Click({
    $script:state = Read-DialJson $script:dataPath
    Render-DialWindow
    Update-InfoWindow
  })

$miDash.Add_Click({ $script:detailsOpen=$true; Update-InfoWindow })

$miPatrol = $menu.Items.Add('Resume input patrol')
$miPatrol.Add_Click({ $script:patrol=$true; $script:patrolController.Reset(0); Update-Patrol 0; Render-DialWindow })

$miQuit.Add_Click({ $form.Close() })

$form.ContextMenuStrip = $menu


# Native hover bubble keeps the desktop footprint small.
$form.Add_MouseEnter({ $script:hovering=$true })
$form.Add_MouseLeave({ $script:hovering=$false })

# 定时读文件
$script:lastWrite = [DateTime]::MinValue
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2500
$timer.Add_Tick({
    try {
      if (Test-Path -LiteralPath $script:dataPath) {
        $write = (Get-Item -LiteralPath $script:dataPath).LastWriteTimeUtc
        if ($write -ne $script:lastWrite) {
          $script:lastWrite = $write
          $newState = Read-DialJson $script:dataPath
          if ($null -ne $newState) {
            $script:state = $newState
            Render-DialWindow
          }
        }
      }
    } catch {
      # 忽略
    }
  })
$timer.Start()

$miPause.Add_Click({
    if ($timer.Enabled) { $timer.Stop(); $miPause.Text = (T 'resume') }
    else { $timer.Start(); $miPause.Text = (T 'pause') }
  })


function Update-Patrol([double]$dt) {
  $tracked=$script:patrolController.TrackHost()
  if ($script:watch.Elapsed.TotalSeconds - $script:lastHostCheck -ge 1) {
    $script:lastHostCheck = $script:watch.Elapsed.TotalSeconds
    if ($script:patrolController.HostAlive()) { $script:lastHostSeen = [DateTime]::UtcNow }
    elseif (([DateTime]::UtcNow - $script:lastHostSeen).TotalSeconds -gt 5) { $form.Close(); return }
  }
  if (-not $tracked) { $infoForm.Hide(); $form.Hide(); return }
  $form.AttachHost($script:patrolController.HostHandle)
  $infoForm.AttachHost($script:patrolController.HostHandle)
  if (-not $form.HostIsActive()) { $infoForm.Hide(); $form.Hide(); return }
  if (-not $script:patrol -or $script:dragging) { return }
  $anchor=$script:inputAnchor.Poll($script:patrolController.HostHandle)
  if ($anchor.Status -ne $script:lastAnchorStatus) {
    $script:lastAnchorStatus=$anchor.Status
    try { @{ status=$anchor.Status; found=$anchor.Found; checkedAt=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path (Split-Path $script:dataPath) 'pet-anchor-status.json') -Encoding UTF8 } catch { }
  }
  if (-not $anchor.Found) { $infoForm.Hide(); $form.Hide(); return }
  $left=$anchor.Left; $right=$anchor.Right-104
  $width=[Math]::Max(0,$right-$left)
  if ($script:motionEnabled -and -not $script:hovering -and -not $menu.Visible -and -not $script:detailsOpen) { $script:patrolController.Advance($dt,$width) }
  $form.Left=[int]($left+[Math]::Min($width,$script:patrolController.Position))
  $form.Top=[int]($anchor.Top-97)
  if (-not $form.Visible) { $form.Show() }
}
# Smooth interpolation uses elapsed time, independent of UI timer jitter.
$motionTimer = New-Object System.Windows.Forms.Timer
$motionTimer.Interval = 20
$script:lastFrame = 0.0
$script:lastSecond = -1
$script:motionEnabled = $true
$miMotion = $menu.Items.Add((T 'motionOff'))
$miMotion.Add_Click({
  $script:motionEnabled = -not $script:motionEnabled
  if ($script:motionEnabled) { $miMotion.Text = (T 'motionOff') } else { $miMotion.Text = (T 'motionOn') }
  Render-DialWindow
})
$motionTimer.Add_Tick({
  $now = $script:watch.Elapsed.TotalSeconds
  $dt = [Math]::Min(0.2, $now - $script:lastFrame)
  $script:lastFrame = $now
  Update-Patrol $dt
  if(-not $form.IsDisposed){ Update-InfoWindow }
  $second = [int][Math]::Floor($now)
  if ($script:motionEnabled -or $second -ne $script:lastSecond) { Render-DialWindow }
  $script:lastSecond = $second
})
$motionTimer.Start()


$languageMenu = New-Object System.Windows.Forms.ToolStripMenuItem((T 'language'))
[void]$menu.Items.Add($languageMenu)
$autoLanguage = $languageMenu.DropDownItems.Add((T 'auto'))
$zhLanguage = $languageMenu.DropDownItems.Add('中文')
$enLanguage = $languageMenu.DropDownItems.Add('English')
function Update-LanguageUI {
  if ($script:lang -eq 'zh') {
    $miPatrol.Text = '沿输入框行走'
  } else {
    $miPatrol.Text = 'Resume input patrol'
  }
  $miRefresh.Text = T 'refresh'; $miQuit.Text = T 'quit'
  if($script:lang -eq 'zh'){$miDash.Text='查看余量详情'}else{$miDash.Text='View usage details'}
  if ($timer.Enabled) { $miPause.Text = T 'pause' } else { $miPause.Text = T 'resume' }
  if ($script:motionEnabled) { $miMotion.Text = T 'motionOff' } else { $miMotion.Text = T 'motionOn' }
  $languageMenu.Text = T 'language'; $autoLanguage.Text = T 'auto'
  $autoLanguage.Checked = $script:languageChoice -eq 'auto'
  $zhLanguage.Checked = $script:languageChoice -eq 'zh'; $enLanguage.Checked = $script:languageChoice -eq 'en'
  Render-DialWindow
}
function Save-UILanguage([string]$choice) {
  Set-UILanguage $choice
  try { [IO.File]::WriteAllText($script:uiPath, ('{"language":"' + $choice + '"}')) } catch { Write-Err 'language' $_ }
  Update-LanguageUI
}
$autoLanguage.Add_Click({ Save-UILanguage 'auto' })
$zhLanguage.Add_Click({ Save-UILanguage 'zh' })
$enLanguage.Add_Click({ Save-UILanguage 'en' })
Update-LanguageUI

# 启动数据泵
$script:feed = $null
if (-not $NoFeed) {
  $node = Resolve-NodeExe
  $root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
  $feedScript = Join-Path $root 'server\dial-feed.mjs'
  if ($node -and (Test-Path -LiteralPath $feedScript)) {
    try {
      $script:feed = Start-Process -FilePath $node -ArgumentList @("`"$feedScript`"", "--interval=$Interval") -WindowStyle Hidden -PassThru
    } catch {
      $script:feed = $null
    }
  }
}

$form.Add_FormClosing({
    try { $script:petMutex.ReleaseMutex(); $script:petMutex.Dispose() } catch { }
    $motionTimer.Stop(); $motionTimer.Dispose(); $timer.Stop(); $timer.Dispose()
    $infoForm.Close(); $infoForm.Dispose()
    if($script:infoBuffer){$script:infoBuffer.Dispose()}
    if($script:bubbleSprites){foreach($sprite in $script:bubbleSprites.Values){$sprite.Dispose()}}
    foreach ($image in $script:walkFrames) { $image.Dispose() }
    try { [IO.File]::Delete($PidFile) } catch { }
    if ($script:feed -and -not $script:feed.HasExited) {
      try { $script:feed.Kill() } catch { }
    }
  })

try {
  [System.Windows.Forms.Application]::Run($form)
} catch {
  Write-Err 'show' $_
}
} catch {
  Write-Err 'init' $_
  try { [IO.File]::Delete($PidFile) } catch { }
}
