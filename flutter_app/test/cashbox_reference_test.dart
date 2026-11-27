import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_master_catalog.dart';
import 'package:nasqo_pro_erp/services/local_account_commands.dart';
import 'package:nasqo_pro_erp/services/local_invoice_roles.dart';
void main(){test('cashbox reference save, edit, archive and replay never post parent; reject foreign/immutable binding',()async{
 sqfliteFfiInit();databaseFactory=databaseFactoryFfi;final dir=await Directory.systemTemp.createTemp('cashbox-reference');await databaseFactory.setDatabasesPath(dir.path);final local=LocalDatabase.instance,db=await local.database,master=LocalMasterCatalog(local);const w='local-erp-workspace';
 try{
 final cash=await LocalAccountCommands(local).save(w,'cash-account',{'name':'صندوق اصطناعي','category':'shop','currency':'ريال','isCashAccount':true});
 final payload={'name':'صندوق جديد','currencyCode':'ريال','accountId':cash,'isActive':true};
 final row=await master.saveCashbox(w,'create-box',payload);expect(await master.saveCashbox(w,'create-box',payload),row);
 expect(await LocalInvoiceRoles.cashAccount(db,'sar',row['id']),cash);
 await master.saveCashbox(w,'rename-box',{...payload,'id':row['id'],'name':'صندوق معدل'});
 await master.saveCashbox(w,'archive-box',{...payload,'id':row['id'],'name':'صندوق معدل','isActive':false});
 expect((await LocalMasterCatalog.read(db,'cashboxes')).single['isActive'],false);
 await expectLater(LocalInvoiceRoles.cashAccount(db,'sar',row['id']),throwsA(isA<InvoicePostingSetupRequired>()));
 await expectLater(master.saveCashbox('foreign','foreign',payload),throwsArgumentError);
 await expectLater(master.saveCashbox(w,'wrong-currency',{...payload,'currencyCode':'دولار'}),throwsStateError);
 await expectLater(master.saveCashbox(w,'extra',{...payload,'sql':'DELETE'}),throwsArgumentError);
 expect(await db.query('journal_lines'),isEmpty);expect(await db.query('stock_movements'),isEmpty);expect(await db.query('ledger_entries'),isEmpty);
 }finally{await db.close();await dir.delete(recursive:true);}
});}
