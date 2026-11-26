import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const plugin=path.join(root,'plugins/codex-usage-coach');
for(const file of ['README.md','LICENSE','install.ps1','uninstall.ps1','start-dial.ps1','install-macos.sh','start-macos.sh','uninstall-macos.sh','.github/workflows/ci.yml','.agents/plugins/marketplace.json']) {
 assert.ok(fs.existsSync(path.join(root,file)),`Missing distribution file: ${file}`);
}
const manifest=JSON.parse(fs.readFileSync(path.join(plugin,'.codex-plugin/plugin.json'),'utf8'));
for(const file of [manifest.mcpServers,manifest.interface.logo,manifest.interface.logoDark,'scripts/dial.ps1','scripts/LayeredPetForm.cs','scripts/InputAnchor.cs','scripts/PatrolController.cs','scripts/macos/CodexCat.swift','scripts/macos/Info.plist','scripts/macos/build.sh','scripts/macos/launch.sh','server/mcp-server.mjs','server/dial-feed.mjs','server/lib/companion-platform.mjs']) {
 assert.ok(fs.existsSync(path.join(plugin,file)),`Broken runtime reference: ${file}`);
}
const frames=path.join(plugin,'assets/lv1');
assert.equal(fs.readdirSync(frames).filter(name=>name.endsWith('.png')).length,121);
for(let index=1;index<=121;index++)assert.ok(fs.existsSync(path.join(frames,String(index).padStart(3,'0')+'.png')));
assert.ok(fs.readFileSync(path.join(frames,'ASSET-LICENSE.md'),'utf8').includes('个人非商业'));
assert.ok(!fs.readdirSync(root).some(name=>/\.(png|zip|log|pid)$/.test(name)),'Root contains generated artifacts');
const forbidden=/[A-Z]:\\Users\\|[A-Z]:\\[^\r\n]*\\plugin\\codex-usage-coach|[\w.+-]+@gmail\.com/i;
function inspect(dir){
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name);
  if(entry.isDirectory())inspect(file);
  else if(/\.(mjs|cjs|cs|swift|sh|plist|ps1|cmd|json|md)$/.test(entry.name))assert.ok(!forbidden.test(fs.readFileSync(file,'utf8')),`Local-only data in ${path.relative(root,file)}`);
 }
}
// This test's patterns intentionally contain example local paths.
for(const dir of ['plugins','.agents'])inspect(path.join(root,dir));
console.log('Distribution files, manifests, 121 frames, image license and portable source checks passed.');
