// Read-only official app-server RPC. No turns, model calls, token export or login.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function quotaSnapshot(result, now=Date.now()) {
  const bucket=result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
  if(!bucket || (bucket.limitId && bucket.limitId!=='codex'))return null;
  const windows=[bucket.primary,bucket.secondary].filter(Boolean);
  const five=windows.find(w=>w.windowDurationMins===300);
  const week=windows.find(w=>w.windowDurationMins===10080);
  const valid=w=>w && Number.isFinite(w.usedPercent) && Number.isFinite(w.resetsAt);
  if(!valid(five) && !valid(week))return null;
  return {t:now,p5:valid(five)?five.usedPercent:null,r5:valid(five)?five.resetsAt:null,pw:valid(week)?week.usedPercent:null,rw:valid(week)?week.resetsAt:null,source:'account/rateLimits/read'};
}
function executable() {
  if(process.env.CODEX_CLI_PATH)return process.env.CODEX_CLI_PATH;
  if(process.platform==='darwin'){
    const bundled='/Applications/Codex.app/Contents/Resources/codex';
    try{fs.accessSync(bundled,fs.constants.X_OK);return bundled;}catch{}
  }
  if(process.platform==='win32' && process.env.LOCALAPPDATA){
    const root=path.join(process.env.LOCALAPPDATA,'OpenAI','Codex','bin');
    try {
      const candidates=fs.readdirSync(root).map(dir=>path.join(root,dir,'codex.exe')).filter(f=>fs.existsSync(f));
      candidates.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
      if(candidates[0])return candidates[0];
    }catch{}
  }
  return 'codex';
}
export function readLiveQuota({command=executable(),timeoutMs=10000}={}) {
  return new Promise(resolve=>{
    let child,finished=false,buffer='';
    const timer=setTimeout(()=>finish(null),timeoutMs);
    function finish(value){if(finished)return;finished=true;clearTimeout(timer);child?.stdin.destroy();child?.kill();resolve(value);}
    try { child=spawn(command,['app-server','--listen','stdio://'],{stdio:['pipe','pipe','ignore'],windowsHide:true}); }catch{finish(null);return;}
    child.on('error',()=>finish(null));child.on('exit',()=>finish(null));
    child.stdin.on('error',()=>finish(null));
    const send=message=>{if(!finished)child.stdin.write(JSON.stringify(message)+'\n');};
    child.stdout.on('data',chunk=>{
      buffer+=chunk.toString('utf8');
      if(buffer.length>1024*1024){finish(null);return;}
      for(;;){
        const newline=buffer.indexOf('\n');if(newline<0)break;
        const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
        let message;try{message=JSON.parse(line);}catch{continue;}
        if(message.id===1){
          if(message.error){finish(null);return;}
          send({method:'initialized'});send({id:2,method:'account/rateLimits/read',params:{}});
        }else if(message.id===2){finish(message.error?null:quotaSnapshot(message.result));}
      }
    });
    send({id:1,method:'initialize',params:{clientInfo:{name:'codex_usage_coach',title:'Usage Coach',version:'0.1.0'}}});
  });
}
