using System;
using System.Threading.Tasks;
using System.Windows.Automation;
public class InputAnchor {
    public class Result { public double Left,Top,Right,Bottom; public bool Found; public string Status; }
    Task<Result> pending;
    DateTime requested=DateTime.MinValue;
    public Result Latest=new Result { Status="not-scanned" };
    public Result Poll(IntPtr host) {
        if(pending!=null && pending.IsCompleted) {
            try { Latest=pending.Result; } catch { Latest=new Result { Status="uia-error" }; }
            pending=null;
        }
        if(pending==null && (DateTime.UtcNow-requested).TotalSeconds>=1) {
            requested=DateTime.UtcNow;
            pending=Task.Run(()=>Find(host));
        }
        if((DateTime.UtcNow-requested).TotalSeconds>3) return new Result { Status="uia-timeout" };
        return Latest;
    }
    static Result Find(IntPtr host) {
        try {
            var root=AutomationElement.FromHandle(host);
            var area=root.Current.BoundingRectangle;
            var candidates=root.FindAll(TreeScope.Descendants,new OrCondition(
                new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit),
                new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Document)));
            AutomationElement chosen=null; double score=double.MinValue;
            foreach(AutomationElement item in candidates) {
                var c=item.Current; var r=c.BoundingRectangle;
                if(c.IsOffscreen || !c.IsEnabled || !c.IsKeyboardFocusable || r.IsEmpty || r.Width<180 || r.Height<20 || r.Height>area.Height*.4 || r.Top<area.Top+area.Height*.45) continue;
                object value;
                if(item.TryGetCurrentPattern(ValuePattern.Pattern,out value) && ((ValuePattern)value).Current.IsReadOnly) continue;
                string name=(c.Name+" "+c.AutomationId).ToLowerInvariant();
                double rank=r.Top+r.Width*.1;
                if(name.Contains("message") || name.Contains("prompt") || name.Contains("composer") || name.Contains("输入") || name.Contains("消息")) rank+=10000;
                if(rank>score){ score=rank; chosen=item; }
            }
            if(chosen==null) return new Result { Status="input-not-exposed" };
            var bounds=chosen.Current.BoundingRectangle;
            return new Result {Found=true,Status="uia",Left=bounds.Left,Top=bounds.Top,Right=bounds.Right,Bottom=bounds.Bottom};
        } catch { return new Result {Status="uia-unavailable"}; }
    }
}
