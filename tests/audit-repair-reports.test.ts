import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {buildStatementReport,reportXlsxBytes} from '../src/utils/reportDocument';
import {buildErpRecordChanges} from '../src/hybrid/erpRecordChanges';
import {createEmptyErpData} from '../src/erp';
import {createHybridHomeFixtureSnapshot} from '../src/hybrid/homeFixture';
const s=createHybridHomeFixtureSnapshot();const account=s.accounts.find(a=>a.id==='acc_sup_usd')!;
const ledger=Array.from({length:12},(_,i)=>({...s.ledger[0],id:`row-${i}`,accountId:account.id,accountName:account.name,entryNumber:i+1,amount:i+10,currency:i===11?'ريال':'دولار',entryDate:i===11?'2025-01-01':'2026-11-25',createdAtMs:1795564800000+i,direction:'credit',settledOnReceipt:false,payment:'credit'})) as typeof s.ledger;
test('165 USD and 21 SAR remain separate, selected currency/date/search and empty result affect exact rows',()=>{
 const report=buildStatementReport({...account,openingBalance:0},ledger,{currency:'دولار',showPreviousBalance:true},true);
 assert.equal(report.rows.length,12);assert.equal(report.totals.find(t=>t.currency==='دولار')?.balance,165);assert.equal(report.totals.find(t=>t.currency==='ريال')?.balance,21);
 const single=buildStatementReport(account,ledger,{currency:'دولار'},false);assert.equal(single.rows.length,11);assert(single.rows.every(r=>r.currency==='دولار'));
 assert.equal(buildStatementReport(account,ledger,{fromDate:'2026-01-01'},true).rows.length,11);
 assert.equal(buildStatementReport(account,ledger,{searchQuery:'DOES-NOT-EXIST'},true).rows.length,0);
});
test('XLSX has numeric amount/balance and currency column, genuine OOXML container',async()=>{
 const r=buildStatementReport(account,ledger,{},true);const bytes=await reportXlsxBytes(r);assert.equal(bytes[0],80);assert.equal(bytes[1],75);
 const book=XLSX.read(bytes,{type:'array'});const table=XLSX.utils.sheet_to_json(book.Sheets['التقرير'],{header:1}) as unknown[][];
 assert.equal(table.length,13);assert.equal(typeof table[1][4],'number');assert.equal(table[0][5],'العملة');assert.equal(typeof table[1][6],'number');
 assert.equal((XLSX.utils.sheet_to_json(book.Sheets['الأرصدة'],{header:1}) as unknown[][]).length,3);
});
test('ERP diff sends only changed records, preserves revision, rejects whole-store deletion/financial markers',()=>{
 const before=createEmptyErpData();const employee={id:'employee-1',name:'اسم',roleTitle:'بائع',department:'محل',basicSalary:5,allowances:0,deductions:0,status:'active',hireDate:'2026-11-25',leaveBalanceDays:21,attendanceToday:'present'} as const;
 const changes=buildErpRecordChanges(before,{...before,employees:[employee]});assert.equal(changes.length,1);assert.equal(changes[0].expectedRevision,0);
 assert.throws(()=>buildErpRecordChanges({...before,employees:[employee]},before),/حذف/);
 assert.throws(()=>buildErpRecordChanges(before,{...before,lastPayrollRunMonth:'2026-11'}),/غير مدعوم/);
});

test('conversion without an approved rate source is refused, not silently 1:1',()=>{
 assert.throws(()=>buildStatementReport(account,ledger,{currency:'مصارفة الكل بعملة ريال'}),/سعر الصرف/);
});
