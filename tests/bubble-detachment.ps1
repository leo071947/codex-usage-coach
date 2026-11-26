$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class BubblePositionProbe {
 public delegate bool Callback(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb,IntPtr p);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
'@
$taskCodexHome=Join-Path $env:USERPROFILE '.codex'
if($env:CODEX_HOME){$taskCodexHome=$env:CODEX_HOME}
$windowId=[int]([IO.File]::ReadAllText((Join-Path $taskCodexHome 'usage-coach\dial-window.pid')))
$script:cat=[IntPtr]::Zero;$script:bubble=[IntPtr]::Zero
[BubblePositionProbe]::EnumWindows({param($h,$arg)
 $ownerId=[uint32]0;[void][BubblePositionProbe]::GetWindowThreadProcessId($h,[ref]$ownerId)
 if($ownerId -eq $windowId){
  $name=New-Object Text.StringBuilder 256;[void][BubblePositionProbe]::GetWindowText($h,$name,256)
  if($name.ToString() -eq 'Codex Cat Info'){$script:bubble=$h}
  elseif($name.ToString().StartsWith('Codex ')){$script:cat=$h}
 }
 return $true
},[IntPtr]::Zero)|Out-Null
if($script:cat -eq [IntPtr]::Zero -or $script:bubble -eq [IntPtr]::Zero){throw 'Pet windows missing'}
$watch=[Diagnostics.Stopwatch]::StartNew();$last=$null;$independent=0;$unexpected=0
while($watch.Elapsed.TotalSeconds -lt 12){
 $cr=New-Object BubblePositionProbe+Rect;$br=New-Object BubblePositionProbe+Rect
 [void][BubblePositionProbe]::GetWindowRect($script:cat,[ref]$cr)
 [void][BubblePositionProbe]::GetWindowRect($script:bubble,[ref]$br)
 $visible=[BubblePositionProbe]::IsWindowVisible($script:bubble)
 if($visible -and $last -and $last.visible -and $cr.Left -ne $last.catX){
  if($br.Left -eq $last.bubbleX -and $br.Top -eq $last.bubbleY){$independent++}else{$unexpected++}
 }
 $last=@{visible=$visible;catX=$cr.Left;bubbleX=$br.Left;bubbleY=$br.Top}
 Start-Sleep -Milliseconds 10
}
Write-Output ('Observed independent cat movement samples: '+$independent+'; bubble jumps during movement: '+$unexpected)
if($unexpected -gt 0){throw 'Bubble still moved with the cat'}
if($independent -eq 0){Write-Output 'No visible walking overlap; repeat with Codex foreground.'}
