import test from 'node:test';
import assert from 'node:assert/strict';
import {parseErpNumber} from '../src/erpInput.ts';
test('ERP numeric input accepts Arabic/Persian decimals and rejects empty/invalid values',()=>{
 for(const [raw,value] of [['٢٬٥٠٠٫٧٥',2500.75],['۱۲.۵',12.5],['0',0],['2.',2],['.5',0.5]] as const)assert.equal(parseErpNumber(raw,'السعر'),value);
 for(const raw of ['',null,'غير صحيح','2x','Infinity','--2'])assert.throws(()=>parseErpNumber(raw,'السعر'),/السعر/);
});
