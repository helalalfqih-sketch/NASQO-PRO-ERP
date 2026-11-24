import 'local_database.dart';
import '../models/erp_models.dart';
import 'local_invoice_roles.dart';

/// Restricted local document posting. Only explicit two-account, single-currency
/// operations are accepted. Stock invoices, tax, discounts, FX and reversals
/// require separate domain commands; never silently omit their accounting.
class LocalDocumentCommands {
  LocalDocumentCommands(this.local);
  final LocalDatabase local;
  static final _id = RegExp(r'^[A-Za-z0-9:_-]{1,150}$');

  static int minor(Object? value) {
    if (value is! num || !value.isFinite || value <= 0 || value > 10000000000) {
      throw ArgumentError('Invalid amount');
    }
    final scaled = value * 100;
    final rounded = scaled.round();
    if ((scaled - rounded).abs() > 0.00001 || rounded <= 0) {
      throw ArgumentError('Amount requires at most two decimal places');
    }
    return rounded;
  }

  static String field(Map<String,dynamic> input,String key,int max,{String fallback=''}) {
    final value = input[key] ?? fallback;
    if (value is! String || value.length > max) throw ArgumentError('Invalid $key');
    return value;
  }

  Future<String> post(String workspace,String key,Map<String,dynamic> input) async {
    final id = input['id'] ?? key;
    final account = input['accountId'];
    final counterpart = input['counterpartAccountId'];
    final kind = input['kind'];
    final direction = input['direction'];
    final payment = input['payment'];
    final currency = input['currency'];
    final content = input['invoiceContent'] ?? 'none';
    final rawLines = input['lines'];
    final box=input['cashboxId'],settlement=input['cashSettlementAccountId'];
    final isCashInvoice=kind=='invoice'&&payment=='cash';
    if (!_id.hasMatch(workspace) || !_id.hasMatch(key) ||
        id is! String || !_id.hasMatch(id) ||
        account is! String || !_id.hasMatch(account) ||
        counterpart is! String || !_id.hasMatch(counterpart) || account == counterpart ||
        !['voucher','simple-entry','invoice'].contains(kind) ||
        !['debit','credit'].contains(direction) ||
        !CurrencyCode.values.any((v) => v != CurrencyCode.currency2 && v.label == currency) ||
        input['deleted'] == true || (input['exchangeRate'] ?? 1) != 1 ||
        (rawLines != null && (rawLines is! List || rawLines.isNotEmpty)) ||
        (box!=null&&payment!='cash') || (input['settledOnReceipt']==true&&!isCashInvoice) ||
        (settlement!=null&&(!isCashInvoice||settlement is! String||!_id.hasMatch(settlement)||settlement==account||settlement==counterpart)) ||
        (isCashInvoice&&settlement==null) ||
        (input['taxAmount'] ?? 0) != 0 || (input['discount'] ?? 0) != 0 ||
        (input['paidAmount'] ?? 0) != 0 ||
        input['reversedEntryId'] != null || input['reversalEntryId'] != null ||
        (kind == 'invoice' && (content != 'free' || !['credit','cash'].contains(payment))) ||
        (kind == 'voucher' && (!['cash','balance'].contains(payment) || content != 'none')) ||
        (kind == 'simple-entry' && (payment != 'balance' || content != 'none'))) {
      throw ArgumentError('Unsupported or incomplete document');
    }
    final date = field(input,'entryDate',10);
    final parsedDate = DateTime.tryParse(date);
    if (parsedDate == null || date.length != 10 ||
        parsedDate.toIso8601String().substring(0,10) != date) {
      throw ArgumentError('Invalid document date');
    }
    final amount = minor(input['amount']);
    final currencyCode = CurrencyCode.values.firstWhere((v) => v.label == currency).name;
    final entryNumber = input['entryNumber'];
    if (entryNumber is! int || entryNumber < 1 || entryNumber > 2147483647) {
      throw ArgumentError('Invalid document number');
    }
    final request = <String,dynamic>{
      'id':id,'accountId':account,'counterpartAccountId':counterpart,
      'kind':kind,'direction':direction,'payment':payment,'currency':currencyCode,
      'invoiceContent':content,'amountMinor':amount,'entryNumber':entryNumber,
      'entryDate':date,'typeLabel':field(input,'typeLabel',60),
      'documentNumber':field(input,'documentNumber',64),
      'details':field(input,'details',600),'expenseCategory':field(input,'expenseCategory',60),
      if(box!=null)'cashboxId':box,if(settlement!=null)'cashSettlementAccountId':settlement,
    };
    await local.commitOperation(workspaceId:workspace,operationId:key,
      operationType:'document.post',payload:request,apply:(txn) async {
        final binding = await txn.query('erp_state',where:'stateKey = ?',
          whereArgs:['sync_workspace_binding']);
        if (binding.isNotEmpty && binding.single['payloadJson'] != workspace) {
          throw StateError('Workspace mismatch');
        }
        final primary = await txn.query('accounts',where:'id = ?',whereArgs:[account]);
        final other = await txn.query('accounts',where:'id = ?',whereArgs:[counterpart]);
        if (primary.length != 1 || other.length != 1 ||
            primary.single['currency'] != currencyCode || other.single['currency'] != currencyCode) {
          throw StateError('Account missing or currency mismatch');
        }
        if(isCashInvoice&&await LocalInvoiceRoles.cashAccount(txn,currencyCode,box)!=settlement)
          throw StateError('Cashbox configuration changed');
        if(kind=='voucher'&&payment=='cash'&&box!=null&&await LocalInvoiceRoles.cashAccount(txn,currencyCode,box)!=counterpart)
          throw StateError('Cashbox configuration changed');
        if (kind == 'voucher' && payment == 'cash' && other.single['isCashAccount'] != 1) {
          throw ArgumentError('Select a cash account as counterpart');
        }
        if (kind == 'invoice' && (primary.single['isCashAccount'] == 1 ||
            other.single['isCashAccount'] == 1)) {
          throw ArgumentError('Credit invoice cannot use a cash account');
        }
        if ((await txn.query('ledger_entries',where:'entryNumber = ?',whereArgs:[entryNumber],limit:1)).isNotEmpty) {
          throw StateError('Document number already exists');
        }
        await txn.insert('ledger_entries',{
          'id':id,'accountId':account,'accountName':primary.single['name'],
          'counterpartAccountId':counterpart,'counterpartAccountName':other.single['name'],
          'kind':kind == 'simple-entry' ? 'simpleEntry' : kind,
          'typeLabel':request['typeLabel'],'payment':payment,'direction':direction,
          'amount':amount/100,'currency':currencyCode,'exchangeRate':1,
          'details':request['details'],'documentNumber':request['documentNumber'],
          'warehouseId':'','warehouseName':'','expenseCategory':request['expenseCategory'],
          'entryNumber':entryNumber,'deleted':0,'entryDate':date,
          'invoiceContent':content,'postingStatus':'posted',
        });
        await txn.insert('journal_entries',{
          'id':id,'currency':currencyCode,'created_at':DateTime.now().toUtc().toIso8601String(),
        });
        final primaryDebit = direction == 'debit';
        await txn.insert('journal_lines',{
          'id':'$id:0','journal_id':id,'account_id':account,
          'debit_minor':primaryDebit?amount:0,'credit_minor':primaryDebit?0:amount,
        });
        await txn.insert('journal_lines',{
          'id':'$id:1','journal_id':id,'account_id':counterpart,
          'debit_minor':primaryDebit?0:amount,'credit_minor':primaryDebit?amount:0,
        });
        if(isCashInvoice){
          await txn.insert('journal_lines',{'id':'$id:2','journal_id':id,'account_id':account,
            'debit_minor':primaryDebit?0:amount,'credit_minor':primaryDebit?amount:0});
          await txn.insert('journal_lines',{'id':'$id:3','journal_id':id,'account_id':settlement,
            'debit_minor':primaryDebit?amount:0,'credit_minor':primaryDebit?0:amount});
        }
        await LocalInvoiceRoles.recordCashbox(txn,id,box);
        return {'id':id};
      });
    return id;
  }
}
