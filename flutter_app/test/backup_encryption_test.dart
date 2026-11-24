import 'dart:convert';
import 'dart:typed_data';
import 'package:cryptography/cryptography.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/services/backup_encryption.dart';

void main() {
  test('encrypted backup can be recovered using an exported synthetic key', () async {
    final plain = Uint8List.fromList(utf8.encode('QA-CONFIDENTIAL-001'));
    final key = await BackupEncryption.newRecoveryKey();
    final recovery = base64Encode(await key.extractBytes());
    final encrypted = await BackupEncryption.encrypt(plain, key);
    final mockDrive = Map<String, Uint8List>.from({'qa.back': encrypted});
    final otherDeviceKey = SecretKey(base64Decode(recovery));
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
}
