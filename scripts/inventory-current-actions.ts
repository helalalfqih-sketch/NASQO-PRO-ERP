/** Source inventory complements acceptance evidence; never marks a control tested. */
import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';
const out='deliverables/audit-repairs';fs.mkdirSync(out,{recursive:true});
const walk=(dir:string):string[]=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const rows:any[]=[];
for(const file of walk('src').filter(f=>f.endsWith('.tsx')&&!f.startsWith('src/mobile/'))){
 const text=fs.readFileSync(file,'utf8'),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 function visit(node:ts.Node){if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){
  const attrs=node.attributes.properties.filter(ts.isJsxAttribute),events=attrs.filter(a=>/^on(Click|Change|Submit|Select|Add|Save|Delete|Close|Open|Manage)/.test(a.name.getText(source)));
  if(events.length){const attr=(key:string)=>attrs.find(a=>a.name.getText(source)===key)?.initializer?.getText(source)??'';
   const parent=ts.isJsxOpeningElement(node)&&ts.isJsxElement(node.parent)?node.parent:node;
   rows.push({file,line:source.getLineAndCharacterOfPosition(node.getStart()).line+1,component:node.tagName.getText(source),label:attr('aria-label')||attr('label')||attr('title'),testId:attr('data-testid'),content:parent.getText(source).replace(/\s+/g,' ').slice(0,260),handlers:events.map(a=>({event:a.name.getText(source),code:a.initializer?.getText(source).slice(0,700)})),verification:'تعريف في الكود فقط — ليس اختبار قبول'});
  }
 }ts.forEachChild(node,visit);}visit(source);
}
fs.writeFileSync(out+'/current-source-controls.json',JSON.stringify(rows,null,2));console.log(`${rows.length} current source controls; no functional success inferred`);
