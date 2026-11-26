using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public class PatrolController {
    public int Frame { get; private set; }
    public double Position { get; private set; }
    public int Direction { get; private set; }
    double accumulator;
    bool atEdge;
    public PatrolController() { Frame=1; Direction=1; }
    public bool IsWalking { get { return Frame>=18 && Frame<=111; } }
    public void Reset(double position) { Position=position; Frame=1; Direction=1; accumulator=0; atEdge=false; }
    public void Advance(double seconds, double width) {
        accumulator+=Math.Min(0.25,Math.Max(0,seconds));
        const double step=1.0/12;
        while(accumulator>=step) {
            accumulator-=step;
            Frame=Frame%121+1;
            if(Frame==18 && atEdge) { Direction=-Direction; atEdge=false; }
            if(IsWalking && !atEdge) {
                Position+=Direction*42*step;
                if(Position>=width) { Position=width; atEdge=true; Frame=112; }
                if(Position<=0) { Position=0; atEdge=true; Frame=112; }
            }
        }
    }
    [StructLayout(LayoutKind.Sequential)] public struct Bounds { public int Left,Top,Right,Bottom; public int Width {get{return Right-Left;}} public int Height {get{return Bottom-Top;}} }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Bounds rect);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    public IntPtr HostHandle;
    public Bounds HostBounds;
    public bool HostAlive() {
        if(HostHandle!=IntPtr.Zero && IsWindow(HostHandle)) return true;
        TrackHost();
        return HostHandle!=IntPtr.Zero && IsWindow(HostHandle);
    }
    public bool TrackHost() {
        if(HostHandle==IntPtr.Zero || !IsWindow(HostHandle)) {
            HostHandle=IntPtr.Zero;
            foreach(var process in Process.GetProcesses()) {
                try {
                    var h=process.MainWindowHandle;
                    if(h==IntPtr.Zero) continue;
                    string path=process.MainModule.FileName;
                    if(path.IndexOf("OpenAI.Codex",StringComparison.OrdinalIgnoreCase)>=0 || process.ProcessName.Equals("Codex",StringComparison.OrdinalIgnoreCase)) { HostHandle=h; break; }
                } catch { } finally { process.Dispose(); }
            }
        }
        return HostHandle!=IntPtr.Zero && IsWindowVisible(HostHandle) && !IsIconic(HostHandle) && GetWindowRect(HostHandle,out HostBounds);
    }
}
