/** Source event inventory only. Text positions do not prove rendering or behavior. */
import fs from 'node:fs';import path from 'node:path';
const out='deliverables/audit-repairs';fs.mkdirSync(out,{recursive:true});
const walk=(dir:string):string[]=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const rows:any[]=[];
for(const file of walk('src').filter(f=>f.endsWith('.tsx')&&!f.startsWith('src/mobile/'))){
 const lines=fs.readFileSync(file,'utf8').split('\n');let component='';
 lines.forEach((text,index)=>{const fn=text.match(/^(?:export )?function (\w+)/);if(fn)component=fn[1];
  for(const event of text.matchAll(/\b(onClick|onChange|onSubmit|onSelect|onAdd\w*|onSave\w*|onDelete\w*|onClose|onOpen\w*|onManage\w*)\s*=/g))rows.push({file,line:index+1,component,event:event[1],context:lines.slice(Math.max(0,index-2),index+3).join('\n').slice(0,1600),verification:'موضع ربط في الكود فقط — ليس اختبار قبول ولا حصرًا لكل حالة ديناميكية'});
 });
}
fs.writeFileSync(out+'/current-source-controls.json',JSON.stringify(rows,null,2));console.log(`${rows.length} source event positions in ${new Set(rows.map(r=>r.file)).size} files; no functional success inferred`);
