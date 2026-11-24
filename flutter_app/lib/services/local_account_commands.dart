import 'local_database.dart';
import '../models/erp_models.dart';

class LocalAccountCommands {
  LocalAccountCommands(this.local);
  final LocalDatabase local;
  static final _identity = RegExp(r'^[A-Za-z0-9:_-]{1,150}$');

  /// Edits are intentionally limited to metadata. Account classification,
  /// currency, opening balance and cash role must not rewrite financial history.
  Future<String> save(String workspace, String key,
      Map<String,dynamic> input, {String? accountId}) async {
    if (!_identity.hasMatch(workspace) || !_identity.hasMatch(key) ||
        (accountId != null && !_identity.hasMatch(accountId))) {
      throw ArgumentError('Invalid identity');
    }
    final name = input['name'];
    final phone = input['phone'] ?? '';
    final note = input['note'] ?? '';
    final limit = input['creditLimit'] ?? 0;
    final category = input['category'];
    final currency = input['currency'];
    final cash = input['isCashAccount'] ?? false;
    final opening = input['openingBalance'] ?? 0;
    final openingDirection = input['openingDirection'] ?? 'credit';
    if (name is! String || name.trim().isEmpty || name.length > 100 ||
        phone is! String || phone.length > 32 ||
        note is! String || note.length > 300 ||
        limit is! num || !limit.isFinite || limit < 0 || limit > 1000000000000 ||
        cash is! bool || !AccountCategory.values.any((v) => v.name == category) ||
        !CurrencyCode.values.any((v) => v != CurrencyCode.currency2 && v.label == currency) ||
        opening is! num || !opening.isFinite || input['groupId'] != null ||
        !['credit','debit'].contains(openingDirection) ||
        (input['settlement'] ?? false) != false || (input['documentNumberRequired'] ?? false) != false ||
        (input['accountImage'] ?? '1') != '1' || (input['sendMode'] ?? 'never') != 'never' ||
        (input['messageMethod'] ?? 'sms') != 'sms') {
      throw ArgumentError('Unsupported account fields');
    }
    final currencyCode = CurrencyCode.values.firstWhere((v) => v.label == currency).name;
    final id = accountId ?? 'account_$key';
    if (id.length > 150) throw ArgumentError('Account ID too long');
    final request = <String,dynamic>{
      'id': id, 'name': name.trim(), 'phone': phone, 'note': note,
      'creditLimit': limit.toDouble(), 'category': category,
      'currency': currencyCode, 'isCashAccount': cash ? 1 : 0,
      'openingBalance': opening.toDouble(), 'openingDirection': openingDirection,
    };
    final isNew = accountId == null;
    final result = await local.commitOperation(
      workspaceId: workspace, operationId: key,
      operationType: isNew ? 'account.create' : 'account.update',
      payload: request,
      syncPayload: (result) => Map<String,dynamic>.from(result['sync'] as Map),
      apply: (txn) async {
        final binding = await txn.query('erp_state', where:'stateKey = ?',
          whereArgs:['sync_workspace_binding']);
        if (binding.isNotEmpty && binding.single['payloadJson'] != workspace) {
          throw StateError('Workspace mismatch');
        }
        final duplicates = await txn.query('accounts',
          where:'name = ? AND category = ? AND id <> ?',
          whereArgs:[name.trim(),category,id]);
        if (duplicates.isNotEmpty) throw ArgumentError('Duplicate account');
        if (isNew) {
          if (opening != 0) throw ArgumentError('Opening balance must be posted separately');
          final max = (await txn.rawQuery('SELECT COALESCE(MAX(codeNumber),0) AS n FROM accounts')).single['n'] as int;
          final row = <String,dynamic>{...request,'codeNumber':max+1};
          await txn.insert('accounts',row);
          return {'id':id,'sync':row};
        }
        final rows = await txn.query('accounts',where:'id = ?',whereArgs:[id]);
        if (rows.length != 1) throw ArgumentError('Account does not exist');
        final before = Map<String,dynamic>.from(rows.single);
        for (final field in ['category','currency','isCashAccount','openingBalance','openingDirection']) {
          if (before[field] != request[field]) throw ArgumentError('Financial attributes are immutable');
        }
        final after = <String,dynamic>{...before,
          for(final field in ['name','phone','note','creditLimit']) field:request[field]};
        await txn.update('accounts',after,where:'id = ?',whereArgs:[id]);
        return {'id':id,'sync':{'id':id,'before':before,'after':after}};
      },
    );
    return result['id'] as String;
  }
}
