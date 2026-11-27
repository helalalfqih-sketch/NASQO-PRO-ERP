#!/usr/bin/env python3
"""Export the existing key only as Google PEPK ciphertext; never log secrets."""
import argparse
import base64
import hashlib
import io
import json
import os
import subprocess
import tempfile
import zipfile
from pathlib import Path

PEPK_SHA256 = 'aaccc0774b240aa5304bdad2a49865e92f229ca73209ecb6eaafe75dc858e24e'

def export(jar, public_key, public_key_sha256, output):
    jar, public_key, output = map(lambda p: Path(p).resolve(), [jar, public_key, output])
    if output.exists():
        raise ValueError('Refusing to overwrite an existing export')
    if hashlib.sha256(jar.read_bytes()).hexdigest() != PEPK_SHA256:
        raise ValueError('Unexpected PEPK tool hash')
    required = ['NASQO_ANDROID_KEYSTORE_BASE64', 'NASQO_ANDROID_STORE_PASSWORD',
                'NASQO_ANDROID_KEY_PASSWORD', 'NASQO_ANDROID_KEY_ALIAS', 'NASQO_ANDROID_CERT_SHA256']
    if any(not os.environ.get(name) for name in required):
        raise ValueError('Signing environment is incomplete')
    child_env = {name: os.environ[name] for name in ['PATH', 'JAVA_HOME', 'LANG', 'LC_ALL'] if name in os.environ}
    child_env.update({name: os.environ[name] for name in required[1:4]})

    def run(label, args, data=None):
        result = subprocess.run(args, input=data, env=child_env, capture_output=True, timeout=90)
        if result.returncode:
            # PEPK errors may include invocation details. Never forward its output.
            raise RuntimeError(label + ' failed; no export released')
        return result.stdout

    # The expected recipient hash must come from the public key provided in Play Console.
    recipient = run('Recipient validation', ['openssl', 'pkey', '-pubin', '-in', str(public_key), '-outform', 'DER'])
    recipient_hash = hashlib.sha256(recipient).hexdigest()
    if recipient_hash != public_key_sha256.lower():
        raise ValueError('Google recipient public key hash mismatch')
    run('RSA recipient validation', ['openssl', 'rsa', '-pubin', '-in', str(public_key), '-noout'])
    expected = os.environ['NASQO_ANDROID_CERT_SHA256'].replace(':', '').lower()
    with tempfile.TemporaryDirectory(prefix='nasqo-pepk-') as directory:
        temp = Path(directory)
        keystore = temp / 'current.jks'
        keystore.write_bytes(base64.b64decode(os.environ[required[0]], validate=True))
        keystore.chmod(0o600)
        certificate = run('Original certificate validation', ['keytool', '-exportcert', '-keystore', str(keystore),
            '-alias', os.environ['NASQO_ANDROID_KEY_ALIAS'], '-storepass:env', 'NASQO_ANDROID_STORE_PASSWORD'])
        if hashlib.sha256(certificate).hexdigest() != expected:
            raise ValueError('Original signing certificate mismatch')
        encrypted = temp / 'output.zip'
        run('PEPK encryption', ['java', '-cp', str(jar), str(Path(__file__).with_name('PlayKeyExport.java')),
                               str(keystore), str(public_key), str(encrypted)])
        payload = encrypted.read_bytes()
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            if sorted(archive.namelist()) != ['certificate.pem', 'encryptedPrivateKey']:
                raise ValueError('Unexpected PEPK archive entries')
            cert = run('Export certificate validation', ['openssl', 'x509', '-outform', 'DER'], archive.read('certificate.pem'))
            if hashlib.sha256(cert).hexdigest() != expected:
                raise ValueError('Export certificate mismatch')
            if len(archive.read('encryptedPrivateKey')) < 256:
                raise ValueError('Invalid encrypted payload')
        output.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(payload)
    return {'sha256': hashlib.sha256(payload).hexdigest(), 'certificateSha256': expected,
            'recipientSpkiSha256': recipient_hash, 'pepkSha256': PEPK_SHA256,
            'contents': ['certificate.pem', 'encryptedPrivateKey'],
            'scope': 'Encrypted export only; Google Play import and upgrade still require verification'}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--jar', required=True)
    parser.add_argument('--public-key', required=True)
    parser.add_argument('--public-key-sha256', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(export(args.jar, args.public_key, args.public_key_sha256, args.output), indent=2))
    except Exception as error:
        # Exception text contains only our fixed stage labels, never environment values.
        print('Export failed:', type(error).__name__)
        raise SystemExit(1)
