import 'dart:typed_data';
import 'package:cryptography/cryptography.dart';
import 'backup_encryption.dart';

typedef RecoveryKeyPrompt = Future<SecretKey?> Function(bool allowGenerate);

/// The cloud transport receives only authenticated ciphertext. The local
/// restore callback receives plaintext only after successful authentication.
/// Null means the user cancelled the native key prompt.
class CloudBackupProtection {
  const CloudBackupProtection(this.requestKey);
  final RecoveryKeyPrompt requestKey;

  Future<T?> upload<T>(Uint8List plain, {
    required Future<T> Function(Uint8List) send,
    Future<Uint8List> Function()? readExisting,
  }) async {
    final key = await requestKey(readExisting == null);
    if (key == null) return null;
    // An overwrite must prove possession of the existing backup's key.
    // Legacy unencrypted files must be retained or migrated to a new file.
    if (readExisting != null) {
      await BackupEncryption.decrypt(await readExisting(), key);
    }
    final encrypted = await BackupEncryption.encrypt(plain, key);
    return await send(encrypted);
  }

  Future<T?> recover<T>(Uint8List encrypted,
      Future<T> Function(Uint8List) receive) async {
    final key = await requestKey(false);
    if (key == null) return null;
    final plain = await BackupEncryption.decrypt(encrypted, key);
    return await receive(plain);
  }
}
