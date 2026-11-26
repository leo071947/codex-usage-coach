using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// Per-pixel alpha compositing: no color key, matte, or opaque window background.
public class SportDialForm : Form {
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; public Point(int x,int y){X=x;Y=y;} }
    [StructLayout(LayoutKind.Sequential)] struct NativeSize { public int W,H; public NativeSize(int w,int h){W=w;H=h;} }
    [StructLayout(LayoutKind.Sequential, Pack=1)] struct Blend { public byte Op, Flags, Alpha, Format; }
    [DllImport("user32.dll", SetLastError=true)] static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr dc, ref Point dst, ref NativeSize size, IntPtr src, ref Point origin, uint key, ref Blend blend, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr h,int n,IntPtr value);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h,uint flag);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
    IntPtr host;
    delegate bool WindowCallback(IntPtr h,IntPtr parameter);
    [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback,IntPtr parameter);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h,uint message,IntPtr w,IntPtr l);
    public static void RequestClose(int processId) {
        EnumWindows(delegate(IntPtr h,IntPtr p) {
            uint pid; GetWindowThreadProcessId(h,out pid);
            if(pid==(uint)processId) PostMessage(h,0x10,IntPtr.Zero,IntPtr.Zero);
            return true;
        },IntPtr.Zero);
    }
    public void AttachHost(IntPtr owner) {
        if(host==owner) return;
        host=owner;
        SetWindowLongPtr(Handle,-8,owner);
        SetWindowPos(Handle,new IntPtr(-2),0,0,0,0,0x13);
    }
    public bool HostIsActive() {
        var foreground=GetForegroundWindow();
        if(foreground==host || GetAncestor(foreground,3)==host) return true;
        uint pid; GetWindowThreadProcessId(foreground,out pid);
        return pid==(uint)System.Diagnostics.Process.GetCurrentProcess().Id;
    }
    protected override CreateParams CreateParams {
        get { var p=base.CreateParams; p.ExStyle |= 0x80000 | 0x80 | 0x08000000; return p; }
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    public SportDialForm() { ShowInTaskbar=false; }
    Bitmap output;
    public void PresentDownsampled(Bitmap source,int width,int height) {
        if(output==null || output.Width!=width || output.Height!=height) {
            if(output!=null) output.Dispose();
            output=new Bitmap(width,height,System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
        }
        using(var g=Graphics.FromImage(output)) {
            g.CompositingMode=System.Drawing.Drawing2D.CompositingMode.SourceCopy;
            g.InterpolationMode=System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode=System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
            g.DrawImage(source,new Rectangle(0,0,width,height),0,0,source.Width,source.Height,GraphicsUnit.Pixel);
        }
        Present(output);
    }
    protected override void Dispose(bool disposing) {
        if(disposing && output!=null){output.Dispose();output=null;}
        base.Dispose(disposing);
    }
    public void Present(Bitmap bitmap) {
        IntPtr screen=GetDC(IntPtr.Zero), memory=IntPtr.Zero, dib=IntPtr.Zero, old=IntPtr.Zero;
        try {
            memory=CreateCompatibleDC(screen);
            dib=bitmap.GetHbitmap(Color.FromArgb(0));
            old=SelectObject(memory,dib);
            var dst=new Point(Left,Top); var origin=new Point(0,0);
            var size=new NativeSize(bitmap.Width,bitmap.Height);
            var blend=new Blend { Op=0, Flags=0, Alpha=255, Format=1 };
            if (!UpdateLayeredWindow(Handle,screen,ref dst,ref size,memory,ref origin,0,ref blend,2))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        } finally {
            if(old!=IntPtr.Zero) SelectObject(memory,old);
            if(dib!=IntPtr.Zero) DeleteObject(dib);
            if(memory!=IntPtr.Zero) DeleteDC(memory);
            if(screen!=IntPtr.Zero) ReleaseDC(IntPtr.Zero,screen);
        }
    }
}

public class GemMenuRenderer : ToolStripProfessionalRenderer {
    protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e) {
        using(var b=new SolidBrush(Color.FromArgb(28,23,39))) e.Graphics.FillRectangle(b,e.AffectedBounds);
    }
    protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e) {
        using(var p=new Pen(Color.FromArgb(112,79,157))) e.Graphics.DrawRectangle(p,0,0,e.ToolStrip.Width-1,e.ToolStrip.Height-1);
    }
    protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e) {
        if(e.Item.Selected && e.Item.Enabled) using(var b=new SolidBrush(Color.FromArgb(58,43,77))) e.Graphics.FillRectangle(b,new Rectangle(3,1,e.Item.Width-6,e.Item.Height-2));
    }
    protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e) {
        using(var p=new Pen(Color.FromArgb(66,49,84))) e.Graphics.DrawLine(p,10,e.Item.Height/2,e.Item.Width-10,e.Item.Height/2);
    }
    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e) {
        e.TextColor=e.Item.Enabled ? Color.FromArgb(204,239,237) : Color.FromArgb(162,132,194);
        base.OnRenderItemText(e);
    }
}
