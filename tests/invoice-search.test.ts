import test from 'node:test';
import assert from 'node:assert/strict';
import { searchInvoiceItems } from '../src/utils/invoiceSearch.ts';
import { findInvoiceCatalogItems } from '../src/utils/invoiceCatalog.ts';
import type { InventoryItemRecord } from '../src/types.ts';
const item=(id:string,patch:Partial<InventoryItemRecord>={}):InventoryItemRecord=>({id,ownerId:'synthetic',name:'صنف تجريبي',warehouseId:'main',quantity:0,avgCost:0,unit:'حبة',...patch});
test('async search preserves warehouse families and Arabic/number ranking without mutation',async()=>{
  const records=[item('source',{sku:'000123',warehouseId:'old',quantityUnverified:true}),item('location',{legacySourceItemId:'source',quantity:4}),item('unrelated',{sku:'000123'}),item('other',{name:'أقلام مُلونة',legacyId:729})];
  const before=JSON.stringify(records);
  for(const query of ['تجريبي','000123','اقلام','٧٢٩','source','ملونه اقلام','absent']) for(const native of [true,false]) {
    assert.deepEqual(await searchInvoiceItems(records,query,'main',native),findInvoiceCatalogItems(records,query,'main',native));
  }
  assert.equal(JSON.stringify(records),before);
});
test('20,000-card indexing yields to input, cancellation aborts promptly and latest search wins',async()=>{
  const records=Array.from({length:20000},(_,i)=>item(`item-${i}`,{name:`اختبار ${i}`,sku:`SKU-${i}`}));
  const abort=new AbortController(); let turns=0;
  const timer=setInterval(()=>turns++,1);
  try {
    const pending=searchInvoiceItems(records,'اختبار','main',false,abort.signal);
    setTimeout(()=>abort.abort(),10);
    await assert.rejects(pending,{name:'AbortError'}); assert(turns>0,'UI timer must run during indexing');
    const result=await searchInvoiceItems(records,'SKU-19999','main',false);
    assert.equal(result[0].id,'item-19999');
    abort.abort(); await assert.rejects(searchInvoiceItems(records,'x','main',false,abort.signal),{name:'AbortError'});
    assert.deepEqual(await searchInvoiceItems(records,'','main',false),[]);
  } finally {clearInterval(timer);}
});
