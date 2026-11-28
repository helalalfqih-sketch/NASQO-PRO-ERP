import { parentPort } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { tsImport } from 'tsx/esm/api';
const { readHomeDashboard } = await tsImport('./homeDashboard.ts', import.meta.url);
let queue=Promise.resolve();
parentPort.on('message', message=>{
  queue=queue.then(async()=>{
    let db;
    try {db=new DatabaseSync(message.path,{readOnly:true}); db.exec('PRAGMA busy_timeout=5000');
      const result=await readHomeDashboard(db,message.workspace,message.scope,new Date(),message.detail);
      parentPort.postMessage({id:message.id,result});
    }catch(e){parentPort.postMessage({id:message.id,error:e instanceof Error?e.message:'تعذر تحديث الرئيسية.'});}
    finally {db?.close();}
  });
});
