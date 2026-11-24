// Run after npm ci. Copy only the original engine and its locked Express
// dependency closure. Do not package private source backups, .env or node_modules wholesale.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
process.chdir(root);
const expected="8bb37903967bd46035426cef6becf042cf51eaf0";
for(const name of ["src","server"]){
  const changed=execFileSync("git",["diff","--name-only",expected,"--",name],{encoding:"utf8"}).trim();
  if(changed)throw new Error("Original web source changed: "+name);
}
if(Number(process.versions.node.split(".")[0])!==24)throw new Error("Use Node 24");
execFileSync(process.execPath,["scripts/check-mobile-runtime.mjs"],{stdio:"inherit"});
execFileSync(process.execPath,["scripts/guard-public-backups.mjs"],{stdio:"inherit"});
execFileSync(process.execPath,["node_modules/vite/bin/vite.js","build","--config","mobile_runtime/vite.config.ts"],{stdio:"inherit"});
const out=path.join(root,"dist","original-web-runtime");
fs.rmSync(out,{recursive:true,force:true});
fs.mkdirSync(path.join(out,"dist"),{recursive:true});
const client=path.join(out,"dist","client");
fs.cpSync(path.join(root,"dist","original-web-client"),client,{recursive:true});
function walk(directory){
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(e=>{
    const p=path.join(directory,e.name);
    if(e.isSymbolicLink())throw new Error("Unexpected symlink in packaged sources");
    return e.isDirectory()?walk(p):e.isFile()?[p]:[];
  });
}
const references=walk(path.join(root,"src")).filter(p=>/\.(tsx?|jsx?|css|html)$/.test(p)).map(p=>fs.readFileSync(p,"utf8")).join("\n")+
  fs.readFileSync("index.html","utf8");
for(const file of walk(path.join(root,"public"))){
  const rel=path.relative(path.join(root,"public"),file).split(path.sep).join("/");
  // Keep declared original UI assets, not unused reference screenshots.
  if(!references.includes("/"+rel)&&!/^assets\/(?:android|iphone|status)\//.test(rel)&&!/^pwa-.*\.png$/.test(rel))continue;
  const dest=path.join(client,rel);
  fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(file,dest);
}
fs.cpSync("server",path.join(out,"server"),{recursive:true,filter:p=>fs.statSync(p).isDirectory()||p.endsWith(".ts")});
fs.mkdirSync(path.join(out,"mobile_runtime"),{recursive:true});
fs.copyFileSync("mobile_runtime/host.mjs",path.join(out,"mobile_runtime","host.mjs"));
fs.writeFileSync(path.join(out,"package.json"),JSON.stringify({private:true,type:"module"}));
const packages=JSON.parse(fs.readFileSync("package-lock.json","utf8")).packages;
const seen=new Set();
function findPackage(from,name,optional){
  let parent=from;
  for(;;){
    const p=path.posix.join(parent,"node_modules",name);
    if(packages[p]&&fs.existsSync(path.join(root,p,"package.json")))return p;
    if(!parent)break;
    const i=parent.lastIndexOf("/node_modules/");parent=i<0?"":parent.slice(0,i);
  }
  if(!optional)throw new Error("Missing locked dependency "+name);
}
function copyPackage(p){
  if(seen.has(p))return;seen.add(p);
  const from=path.join(root,p),dest=path.join(out,p);
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.cpSync(from,dest,{recursive:true,filter:file=>{
    const rel=path.relative(from,file);
    if(rel.split(path.sep).includes("node_modules"))return false;
    if(fs.lstatSync(file).isSymbolicLink())throw new Error("Unexpected package symlink");
    return true;
  }});
  const meta=packages[p];
  for(const [name] of Object.entries(meta.dependencies??{})){
    const next=findPackage(p,name,Object.hasOwn(meta.optionalDependencies??{},name));
    if(next)copyPackage(next);
  }
  for(const name of Object.keys(meta.optionalDependencies??{})){
    const next=findPackage(p,name,true);if(next)copyPackage(next);
  }
}
copyPackage(findPackage("","express",false));
for(const p of walk(out)){
  const rel=path.relative(out,p);
  if(/(?:^|[\\/])\.env(?:\.|$)/i.test(rel)||/\.(?:back|db|sqlite|sqlite3|dump|sql)(?:\.gz)?$/i.test(rel))
    throw new Error("Private or database file in runtime package");
}
const zip=path.join(root,"dist","original-web-runtime.zip");
fs.rmSync(zip,{force:true});
execFileSync("python3",["-c","import pathlib,sys,zipfile\nroot=pathlib.Path(sys.argv[1]); out=pathlib.Path(sys.argv[2])\nwith zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:\n for p in sorted(root.rglob('*')):\n  if p.is_file(): z.write(p,p.relative_to(root).as_posix())",out,zip],{stdio:"inherit"});
const sha=crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
fs.writeFileSync(zip+".sha256",sha+"\n");
console.log("Packaged original web runtime. Locked packages:",seen.size,"SHA256:",sha);
