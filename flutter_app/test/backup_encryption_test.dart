import 'dart:convert';
import 'dart:typed_data';
import 'package:cryptography/cryptography.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/services/backup_encryption.dart';
import 'package:nasqo_pro_erp/services/cloud_backup_protection.dart';

void main() {
  test('encrypted backup can be recovered using an exported synthetic key', () async {
    final plain = Uint8List.fromList(utf8.encode('QA-CONFIDENTIAL-001'));
    final key = await BackupEncryption.newRecoveryKey();
    final recovery = await BackupEncryption.exportRecoveryKey(key);
    final encrypted = await BackupEncryption.encrypt(plain, key);
    final mockDrive = Map<String, Uint8List>.from({'qa.back': encrypted});
    final otherDeviceKey = BackupEncryption.importRecoveryKey(recovery);
    expect(await BackupEncryption.decrypt(mockDrive['qa.back']!, otherDeviceKey), orderedEquals(plain));
    expect(await BackupEncryption.encrypt(plain, key), isNot(orderedEquals(encrypted)));
    final wrong = await BackupEncryption.newRecoveryKey();
    await expectLater(BackupEncryption.decrypt(encrypted, wrong), throwsA(isA<SecretBoxAuthenticationError>()));
    final tampered = Uint8List.fromList(encrypted);
    tampered[tampered.length - 1] ^= 1;
    await expectLater(BackupEncryption.decrypt(tampered, otherDeviceKey), throwsA(isA<SecretBoxAuthenticationError>()));
    final badHeader = Uint8List.fromList(encrypted);
    badHeader[0] ^= 1;
    await expectLater(BackupEncryption.decrypt(badHeader, otherDeviceKey), throwsFormatException);
  });
  test('cloud transport only receives ciphertext and authenticates before restore or overwrite', () async {
    final plain = Uint8List.fromList(utf8.encode('SYNTHETIC_LEDGER_ERP_003'));
    final key = await BackupEncryption.newRecoveryKey();
    final recovery = await BackupEncryption.exportRecoveryKey(key);
    final restoredKey = BackupEncryption.importRecoveryKey(recovery);
    final wrong = await BackupEncryption.newRecoveryKey();
    final store = <String, Uint8List>{};
    var writes = 0, restores = 0;
    Future<bool> send(Uint8List bytes) async {
      expect(BackupEncryption.hasEnvelopeHeader(bytes), true);
      expect(bytes, isNot(orderedEquals(plain)));
      expect(bytes.length, lessThanOrEqualTo(BackupEncryption.maxEnvelope));
      store['mock'] = Uint8List.fromList(bytes);
      writes++;
      return true;
    }
    Future<bool> receive(Uint8List bytes) async {
      expect(bytes, orderedEquals(plain));
      restores++;
      return true;
    }
    Future<Uint8List> existing() async => store['mock']!;
    final writer = CloudBackupProtection((generate) async {
      expect(generate, true);
      return key;
    });
    expect(await writer.upload(plain, send: send), true);
    final reader = CloudBackupProtection((generate) async {
      expect(generate, false);
      return restoredKey;
    });
    expect(await reader.recover(await existing(), receive), true);
    final rejected = CloudBackupProtection((_) async => wrong);
    await expectLater(rejected.recover(await existing(), receive),
      throwsA(isA<SecretBoxAuthenticationError>()));
    await expectLater(rejected.upload(plain, send: send, readExisting: existing),
      throwsA(isA<SecretBoxAuthenticationError>()));
    final corrupted = Uint8List.fromList(await existing());
    corrupted[corrupted.length - 1] ^= 1;
    await expectLater(reader.recover(corrupted, receive),
      throwsA(isA<SecretBoxAuthenticationError>()));
    await expectLater(reader.recover(plain, receive), throwsFormatException);
    await expectLater(reader.upload(plain, send: send, readExisting: () async => plain),
      throwsFormatException);
    final cancelled = CloudBackupProtection((_) async => null);
    expect(await cancelled.upload(plain, send: send), isNull);
    expect(await cancelled.recover(await existing(), receive), isNull);
    expect(writes, 1);
    expect(restores, 1);
    final before = Uint8List.fromList(await existing());
    expect(await reader.upload(plain, send: send, readExisting: existing), true);
    expect(await existing(), isNot(orderedEquals(before)));
    expect(await reader.recover(await existing(), receive), true);
    expect(writes, 2);
    expect(restores, 2);
    for (final invalid in ['', List.filled(44, 'A').join(), recovery.substring(0, 43), '!' + recovery.substring(1)]) {
      expect(() => BackupEncryption.importRecoveryKey(invalid), throwsFormatException);
    }
  });

}
