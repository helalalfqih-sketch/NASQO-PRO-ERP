import test from 'node:test';
import assert from 'node:assert/strict';
import { NasqoHybridBridge, HybridBridgeError } from '../src/hybrid/bridge';
import { hybridRequestLengthLimit } from '../src/hybrid/messageLimits';
import { HYBRID_PROTOCOL_VERSION } from '../src/hybrid/contracts';

test('large card and CRUD requests reach transport; oversized controls fail immediately without a write',async()=>{
 const bridge=new NasqoHybridBridge();let calls=0;
 bridge.setTransportForTesting({postMessage(raw){calls++;const req=JSON.parse(raw);queueMicrotask(()=>bridge.handleInbound({protocolVersion:HYBRID_PROTOCOL_VERSION,kind:'response',requestId:req.requestId,action:req.action,ok:true,data:{saved:true}}));}});
 const items=Array.from({length:10000},(_,i)=>({name:`Synthetic ${i}`,sku:`000${i}`,unit:'حبة',sellingPrice:25}));
 assert(JSON.stringify(items).length>32768);
 assert.deepEqual(await bridge.invoke('importInventoryItems',{workspaceId:'local-erp-workspace',items,mode:'insert-only'}),{saved:true});
 assert.deepEqual(await bridge.invoke('saveErpRecords',{workspaceId:'local-erp-workspace',changes:[{note:'x'.repeat(40000)}] as any}),{saved:true});
 await assert.rejects(()=>bridge.invoke('getSnapshot',{note:'x'.repeat(40000)} as any),e=>e instanceof HybridBridgeError&&e.code==='VALIDATION_ERROR');
 await assert.rejects(()=>bridge.invoke('importInventoryItems',{workspaceId:'local-erp-workspace',items:[{name:'x'.repeat(hybridRequestLengthLimit('importInventoryItems'))}],mode:'insert-only'}),e=>e instanceof HybridBridgeError&&e.code==='VALIDATION_ERROR');
 assert.equal(calls,2);bridge.resetForTesting();
});
