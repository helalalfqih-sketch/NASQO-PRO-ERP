import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_account_commands.dart';
import 'package:nasqo_pro_erp/services/local_document_commands.dart';
import 'package:nasqo_pro_erp/services/local_document_lifecycle.dart';
import 'package:nasqo_pro_erp/hybrid/local_snapshot_adapter.dart';

void main(){
  test('draft lifecycle and descriptive edits preserve stock and balanced journals',()async{
    sqfliteFfiInit();
    databaseFactory=databaseFactoryFfi;
    final dir=await Directory.systemTemp.createTemp('nasqo_drafts_');
    await databaseFactory.setDatabasesPath(dir.path);
    final local=LocalDatabase.instance,db=await LocalDatabase.instance.database;
    const w='local-erp-workspace';
    final a=LocalAccountCommands(local),l=LocalDocumentLifecycle(local);
    try{
      final customer=await a.save(w,'customer',{'name':'Customer','category':'clients','currency':'ريال'});
      final revenue=await a.save(w,'revenue',{'name':'Revenue','category':'sales','currency':'ريال'});
      await db.insert('warehouses',{'id':'wh','name':'Warehouse','details':'','isDefault':1});
      await db.insert('inventory_items',{'id':'item','name':'Item','unit':'piece','quantity':0,'avgCost':0,'warehouseId':'wh','minThreshold':0,'sku':''});
      Map<String,dynamic> quote(String id,int number,{String kind='quote',num quantity=1.5})=>{
        'id':id,'kind':kind,'payment':'credit','direction':'debit','invoiceContent':'items',
        'accountId':customer,'amount':quantity*10-1+2,'taxAmount':2,'currency':'ريال',
        'warehouseId':'wh','entryNumber':number,'entryDate':'2026-11-24','documentNumber':'REF',
        'lines':[{'inventoryItemId':'item','itemName':'Item','warehouseId':'wh','unit':'piece',
          'unitNum':1,'quantity':quantity,'price':10,'discount':1,'total':quantity*10-1}],
      };
      final first=quote('q',1);
      expect(await l.saveDraft(w,'q-op',first),'q');
      expect(await l.saveDraft(w,'q-op',first),'q');
      expect(await db.query('ledger_entries'),hasLength(1));
      expect(await db.query('journal_entries'),isEmpty);
      expect(await db.query('stock_movements'),isEmpty);
      expect((await db.query('inventory_items')).single['quantity'],0);
      final details=await LocalDocumentLifecycle.draft(db,'q');
      expect((details!['lines'] as List).single['quantity'],1.5);
      final snapshot=await HybridLocalSnapshotAdapter.readFromDevice();
      expect((snapshot['ledger'] as List).single['localDraft'],true);
      expect((snapshot['ledger'] as List).single['postingStatus'],'draft');
      await expectLater(l.saveDraft(w,'bad-total',{...first,'amount':100},editingId:'q'),throwsArgumentError);
      await l.saveDraft(w,'q-update',quote('q',1,quantity:2),editingId:'q');
      expect((await db.query('ledger_entries')).single['amount'],21);
      expect((await db.query('invoice_lines')).single['quantity'],2);
      await expectLater(l.trash(w,'bad-delete','q',permanent:true),throwsStateError);
      await l.trash(w,'q-trash','q',deleted:true);
      expect((await db.query('ledger_entries')).single['deleted'],1);
      await expectLater(l.saveDraft(w,'bad-edit',first,editingId:'q'),throwsStateError);
      await l.trash(w,'q-restore','q',deleted:false);
      expect((await db.query('ledger_entries')).single['deleted'],0);
      await l.trash(w,'q-trash2','q',deleted:true);
      await l.trash(w,'q-delete','q',permanent:true);
      expect(await db.query('ledger_entries'),isEmpty);
      expect(await db.query('invoice_lines'),isEmpty);
      expect(await LocalDocumentLifecycle.draft(db,'q'),isNull);
      await l.saveDraft(w,'order-op',quote('o',2,kind:'order'));
      expect(await db.query('journal_entries'),isEmpty);
      expect(await db.query('stock_movements'),isEmpty);
      final docs=LocalDocumentCommands(local);
      await docs.post(w,'posted-op',{'id':'posted','kind':'invoice','invoiceContent':'free','payment':'credit','direction':'debit',
        'accountId':customer,'counterpartAccountId':revenue,'currency':'ريال','amount':25,
        'entryNumber':3,'entryDate':'2026-11-24','details':'Original'});
      final legs=await db.query('journal_lines',orderBy:'id');
      await expectLater(l.trash(w,'bad-posted-trash','posted',deleted:true),throwsStateError);
      await expectLater(l.amendMetadata(w,'bad-money','posted',{'accountId':customer,'details':'X','amount':99}),throwsStateError);
      await l.amendMetadata(w,'metadata','posted',{'accountId':customer,'details':'Revised description','documentNumber':'NEW'});
      expect(await db.query('journal_lines',orderBy:'id'),legs);
      final row=(await db.query('ledger_entries',where:'id = ?',whereArgs:['posted'])).single;
      expect(row['amount'],25);
      expect(row['details'],'Revised description');
      expect(row['documentNumber'],'NEW');
      expect(await db.query('stock_movements'),isEmpty);
    }finally{
      await local.close();
      await dir.delete(recursive:true);
    }
  });
}
