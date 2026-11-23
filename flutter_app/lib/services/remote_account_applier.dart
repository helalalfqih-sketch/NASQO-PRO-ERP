import 'package:sqflite/sqflite.dart';

Future<void> applyRemoteAccount(Transaction txn, String workspaceId,
    Map<String, dynamic> operation) async {
  if (operation['workspace_id'] != workspaceId ||
      operation['operation_type'] != 'account.create') {
    throw StateError('Unsupported remote operation');
  }
  final payload = operation['payload'];
  if (payload is! Map<String, dynamic>) {
    throw const FormatException('Invalid account payload');
  }
  const strings = ['id','name','category','phone','currency','note','openingDirection'];
  const numbers = ['creditLimit','openingBalance'];
  const integers = ['isCashAccount','codeNumber'];
  final row = <String, dynamic>{};
  for (final key in strings) {
    final value = payload[key];
    if (value is! String) throw FormatException('Invalid account field: $key');
    row[key] = value;
  }
  for (final key in numbers) {
    final value = payload[key];
    if (value is! num || !value.isFinite) {
      throw FormatException('Invalid account field: $key');
    }
    row[key] = value;
  }
  for (final key in integers) {
    final value = payload[key];
    if (value is! int) throw FormatException('Invalid account field: $key');
    row[key] = value;
  }
  if ((row['id'] as String).isEmpty || (row['name'] as String).trim().isEmpty ||
      row['openingBalance'] != 0 || ![0,1].contains(row['isCashAccount'])) {
    throw const FormatException('Invalid account creation');
  }
  // Never replace existing financial records. A collision rolls back the page.
  await txn.insert('accounts', row, conflictAlgorithm: ConflictAlgorithm.abort);
}
