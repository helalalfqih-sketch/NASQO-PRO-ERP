import 'dart:convert';
import 'dart:typed_data';
import 'package:cryptography/cryptography.dart';

/// Versioned authenticated backup envelope. The recovery key must be
/// generated securely and retained separately from the backup.
class BackupEncryption {
  static final _cipher = AesGcm.with256bits();
  static final _aad = utf8.encode('NASQO-DRIVE-BACKUP-V1');
  static const maxPlaintext = 32 * 1024 * 1024;

  static Future<SecretKey> newRecoveryKey() => _cipher.newSecretKey();

  static Future<String> exportRecoveryKey(SecretKey key) async {
    final bytes = await key.extractBytes();
    if (bytes.length != 32) throw ArgumentError('Invalid recovery key length');
    return base64UrlEncode(bytes);
  }

  static SecretKey importRecoveryKey(String encoded) {
    final value = encoded.trim();
    if (value.length != 44 || !RegExp(r'^[A-Za-z0-9_-]{43}=

  static Future<Uint8List> encrypt(Uint8List bytes, SecretKey key) async {
    if (bytes.isEmpty || bytes.length > maxPlaintext) {
      throw ArgumentError('Invalid backup size');
    }
    final box = await _cipher.encrypt(bytes, secretKey: key, aad: _aad);
    return Uint8List.fromList([
      ..._aad, ...box.nonce, ...box.mac.bytes, ...box.cipherText,
    ]);
  }

  static Future<Uint8List> decrypt(Uint8List bytes, SecretKey key) async {
    final offset = _aad.length;
    if (bytes.length <= offset + 28 ||
        bytes.length > offset + 28 + maxPlaintext) {
      throw const FormatException('Invalid encrypted backup size');
    }
    for (var i = 0; i < offset; i++) {
      if (bytes[i] != _aad[i]) {
        throw const FormatException('Unsupported encrypted backup format');
      }
    }
    final box = SecretBox(
      bytes.sublist(offset + 28),
      nonce: bytes.sublist(offset, offset + 12),
      mac: Mac(bytes.sublist(offset + 12, offset + 28)),
    );
    final plain = await _cipher.decrypt(box, secretKey: key, aad: _aad);
    return Uint8List.fromList(plain);
  }
}
).hasMatch(value)) {
      throw const FormatException('Invalid recovery key format');
    }
    final bytes = base64Url.decode(value);
    if (bytes.length != 32 || base64UrlEncode(bytes) != value) {
      throw const FormatException('Invalid recovery key');
    }
    return SecretKey(bytes);
  }

  static Future<Uint8List> encrypt(Uint8List bytes, SecretKey key) async {
    if (bytes.isEmpty || bytes.length > maxPlaintext) {
      throw ArgumentError('Invalid backup size');
    }
    final box = await _cipher.encrypt(bytes, secretKey: key, aad: _aad);
    return Uint8List.fromList([
      ..._aad, ...box.nonce, ...box.mac.bytes, ...box.cipherText,
    ]);
  }

  static Future<Uint8List> decrypt(Uint8List bytes, SecretKey key) async {
    final offset = _aad.length;
    if (bytes.length <= offset + 28 ||
        bytes.length > offset + 28 + maxPlaintext) {
      throw const FormatException('Invalid encrypted backup size');
    }
    for (var i = 0; i < offset; i++) {
      if (bytes[i] != _aad[i]) {
        throw const FormatException('Unsupported encrypted backup format');
      }
    }
    final box = SecretBox(
      bytes.sublist(offset + 28),
      nonce: bytes.sublist(offset, offset + 12),
      mac: Mac(bytes.sublist(offset + 12, offset + 28)),
    );
    final plain = await _cipher.decrypt(box, secretKey: key, aad: _aad);
    return Uint8List.fromList(plain);
  }
}
