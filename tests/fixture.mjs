import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Tests never read account credentials or change a real Codex configuration.
export const testHome=fs.mkdtempSync(path.join(os.tmpdir(),'usage-coach-test-'));
process.env.CODEX_HOME=testHome;
delete process.env.USAGE_COACH_SESSIONS;
process.env.USAGE_COACH_AUTO_PET='0';
const sessions=path.join(testHome,'sessions');
fs.mkdirSync(sessions);
const now=Date.now();
const events=Array.from({length:25},(_,i)=>({
 timestamp:new Date(now-(24-i)*3600000).toISOString(),type:'event_msg',
 payload:{type:'token_count',info:{last_token_usage:{total_tokens:2000,input_tokens:1500,cached_input_tokens:1000,output_tokens:500,reasoning_output_tokens:100}},rate_limits:{primary:{used_percent:20,resets_at:Math.floor((now+3*3600000)/1000)},secondary:{used_percent:30+i,resets_at:Math.floor((now+3*86400000)/1000)}}}
}));
fs.writeFileSync(path.join(sessions,'rollout-test.jsonl'),events.map(event=>JSON.stringify(event)).join('\n')+'\n');
process.on('exit',()=>fs.rmSync(testHome,{recursive:true,force:true}));
