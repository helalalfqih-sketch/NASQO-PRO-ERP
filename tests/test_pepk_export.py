"""Real PEPK round trip with disposable keys; never uses release credentials."""
import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

class PepkExport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.jar = os.environ.get('NASQO_TEST_PEPK_JAR')
        if not cls.jar:
            raise unittest.SkipTest('Set NASQO_TEST_PEPK_JAR to the pinned official public JAR')
        from cryptography.hazmat.primitives import serialization
        cls.temp = tempfile.TemporaryDirectory(prefix='nasqo-pepk-test-')
        cls.root = Path(cls.temp.name)
        cls.env = os.environ.copy()
        cls.env.update(NASQO_ANDROID_STORE_PASSWORD='synthetic-test-only',
                       NASQO_ANDROID_KEY_PASSWORD='synthetic-test-only', NASQO_ANDROID_KEY_ALIAS='synthetic')
        cls.run_command(['keytool', '-genkeypair', '-keystore', str(cls.root/'test.jks'), '-alias', 'synthetic',
            '-keyalg', 'RSA', '-keysize', '2048', '-validity', '2', '-dname', 'CN=Synthetic PEPK test',
            '-storepass:env', 'NASQO_ANDROID_STORE_PASSWORD', '-keypass:env', 'NASQO_ANDROID_KEY_PASSWORD'])
        cls.certificate = cls.run_command(['keytool', '-exportcert', '-keystore', str(cls.root/'test.jks'),
            '-alias', 'synthetic', '-storepass:env', 'NASQO_ANDROID_STORE_PASSWORD'])
        cls.run_command(['openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:3072',
                         '-out', str(cls.root/'receiver-private.pem')])
        cls.run_command(['openssl', 'pkey', '-in', str(cls.root/'receiver-private.pem'), '-pubout',
                         '-out', str(cls.root/'receiver-public.pem')])
        cls.receiver = serialization.load_pem_private_key((cls.root/'receiver-private.pem').read_bytes(), None)
        der = cls.receiver.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        cls.recipient_hash = hashlib.sha256(der).hexdigest()
        cls.env.update(NASQO_ANDROID_KEYSTORE_BASE64=base64.b64encode((cls.root/'test.jks').read_bytes()).decode(),
                       NASQO_ANDROID_CERT_SHA256=hashlib.sha256(cls.certificate).hexdigest())

    @classmethod
    def run_command(cls, args):
        return subprocess.run(args, env=cls.env, capture_output=True, check=True).stdout

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def invoke(self, name, recipient=None, signer=None):
        output = self.root/name
        env = self.env.copy()
        if signer: env['NASQO_ANDROID_CERT_SHA256'] = signer
        args = [sys.executable, str(Path(__file__).resolve().parents[1]/'scripts/export-play-signing-key.py'),
                '--jar', self.jar, '--public-key', str(self.root/'receiver-public.pem'),
                '--public-key-sha256', recipient or self.recipient_hash, '--output', str(output)]
        return subprocess.run(args, env=env, capture_output=True, text=True), output

    def test_encrypted_round_trip_matches_original_certificate(self):
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization, keywrap
        from cryptography.hazmat.primitives.asymmetric import padding
        result, output = self.invoke('valid.zip')
        self.assertEqual(result.returncode, 0, result.stdout)
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(sorted(archive.namelist()), ['certificate.pem', 'encryptedPrivateKey'])
            encrypted = archive.read('encryptedPrivateKey')
            rsa_bytes = self.receiver.key_size // 8
            wrapping_key = self.receiver.decrypt(encrypted[:rsa_bytes], padding.OAEP(
                mgf=padding.MGF1(hashes.SHA1()), algorithm=hashes.SHA1(), label=None))
            private_der = keywrap.aes_key_unwrap_with_padding(wrapping_key, encrypted[rsa_bytes:])
            restored = serialization.load_der_private_key(private_der, None)
            expected = x509.load_der_x509_certificate(self.certificate).public_key()
            self.assertEqual(restored.public_key().public_numbers(), expected.public_numbers())
        self.assertEqual(json.loads(result.stdout)['recipientSpkiSha256'], self.recipient_hash)
        self.assertNotIn(self.env['NASQO_ANDROID_STORE_PASSWORD'], result.stdout + result.stderr)
        self.assertNotIn(self.env['NASQO_ANDROID_KEYSTORE_BASE64'], result.stdout + result.stderr)

    def test_rejects_wrong_google_recipient(self):
        result, output = self.invoke('wrong-recipient.zip', recipient='0'*64)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(output.exists())

    def test_rejects_wrong_signing_identity(self):
        result, output = self.invoke('wrong-signer.zip', signer='0'*64)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(output.exists())

    def test_refuses_to_overwrite_export(self):
        target = self.root/'existing.zip'
        target.write_bytes(b'preserve')
        result, _ = self.invoke('existing.zip')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(target.read_bytes(), b'preserve')

if __name__ == '__main__':
    unittest.main()
