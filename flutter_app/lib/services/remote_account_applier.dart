import 'package:sqflite/sqflite.dart';
import '../models/erp_models.dart';

Map<String,dynamic> validateRemoteAccount(Object? payload) {
  if (payload is! Map<String,dynamic>) throw const FormatException('Invalid account payload');
  const strings = ['id','name','category','phone','currency','note','openingDirection'];
  const numbers = ['creditLimit','openingBalance'];
  const integers = ['isCashAccount','codeNumber'];
  final row = <String,dynamic>{};
  for (final key in strings) {
    final value = payload[key];
    if (value is! String) throw FormatException('Invalid account field: $key');
    row[key] = value;
  }
  for (final key in numbers) {
    final value = payload[key];
    if (value is! num || !value.isFinite) throw FormatException('Invalid account field: $key');
    row[key] = value;
  }
  for (final key in integers) {
    final value = payload[key];
    if (value is! int) throw FormatException('Invalid account field: $key');
    row[key] = value;
  }
  if ((row['id'] as String).isEmpty || (row['name'] as String).trim().isEmpty ||
      !AccountCategory.values.any((v) => v.name == row['category']) ||
      !CurrencyCode.values.any((v) => v.name == row['currency']) ||
      !['credit','debit'].contains(row['openingDirection']) ||
      (row['creditLimit'] as num) < 0 || ![0,1].contains(row['isCashAccount']) ||
      (row['codeNumber'] as int) < 1) {
    throw const FormatException('Invalid account record');
  }
  return row;
}
bool _same(Map<String,dynamic> a, Map<String,dynamic> b) =>
  a.length == b.length && a.keys.every((key) => a[key] == b[key]);

Future<void> applyRemoteAccount(Transaction txn, String workspaceId,
    Map<String, dynamic> operation) async {
  if (operation['workspace_id'] != workspaceId) throw StateError('Workspace mismatch');
  final type = operation['operation_type'];
  final payload = operation['payload'];
  if (type == 'account.create') {
    final row = validateRemoteAccount(payload);
    if (row['openingBalance'] != 0) throw const FormatException('Invalid opening balance');
    await txn.insert('accounts',row,conflictAlgorithm:ConflictAlgorithm.abort);
    return;
  }
  if (type != 'account.update' || payload is! Map<String,dynamic>) {
    throw StateError('Unsupported remote operation');
  }
  final before = validateRemoteAccount(payload['before']);
  final after = validateRemoteAccount(payload['after']);
  if (payload['id'] != before['id'] || after['id'] != before['id'] ||
      before.keys.any((k) => !['name','phone','note','creditLimit'].contains(k) && before[k] != after[k])) {
    throw const FormatException('Immutable account fields changed');
  }
  final current = await txn.query('accounts',where:'id = ?',whereArgs:[before['id']]);
  if (current.length != 1 || !_same(Map<String,dynamic>.from(current.single),before)) {
    throw StateError('Concurrent account edit: manual reconciliation required');
  }
  await txn.update('accounts',after,where:'id = ?',whereArgs:[before['id']]);
}
