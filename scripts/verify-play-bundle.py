#!/usr/bin/env python3
"""Check the actual signed bundle metadata and 64-bit ELF load segments."""
import json
import struct
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

bundle, manifest, config, output, expected_code = sys.argv[1:]
android = '{http://schemas.android.com/apk/res/android}'
root = ET.parse(manifest).getroot()
assert root.attrib['package'] == 'com.indexesstore.nasqo_pro_erp', 'Package changed'
assert root.attrib[android + 'versionCode'] == expected_code, 'Wrong version code'
sdk = root.find('uses-sdk')
assert int(sdk.attrib[android + 'targetSdkVersion']) == 36, 'Play requires target API 36'
assert int(sdk.attrib[android + 'minSdkVersion']) == 23, 'Minimum SDK changed'
app = root.find('application')
assert app.attrib.get(android + 'debuggable', 'false') == 'false', 'Debuggable bundle'
assert 'PAGE_ALIGNMENT_16K' in Path(config).read_text(), 'Bundle must request 16 KB zip alignment'
libraries = []
with zipfile.ZipFile(bundle) as archive:
    for name in archive.namelist():
        if not name.endswith('.so') or not any('/lib/' + abi + '/' in name for abi in ['arm64-v8a', 'x86_64']):
            continue
        data = archive.read(name)
        assert data[:4] == b'\x7fELF' and data[4] == 2 and data[5] == 1, 'Expected little-endian ELF64: ' + name
        offset = struct.unpack_from('<Q', data, 32)[0]
        size, count = struct.unpack_from('<HH', data, 54)
        alignments = []
        for index in range(count):
            header = struct.unpack_from('<IIQQQQQQ', data, offset + index * size)
            if header[0] == 1:  # PT_LOAD
                assert header[7] >= 16384 and (header[2] - header[3]) % 16384 == 0, 'Unaligned ELF: ' + name
                alignments.append(header[7])
        assert alignments, 'No load segments: ' + name
        libraries.append({'name': name, 'loadAlignments': alignments})
assert libraries and any('/arm64-v8a/' in entry['name'] for entry in libraries), 'Missing ARM64 libraries'
result = {'package': root.attrib['package'], 'versionCode': int(expected_code),
          'versionName': root.attrib[android + 'versionName'], 'targetSdk': 36, 'minSdk': 23,
          'debuggable': False, 'bundleAlignment': 'PAGE_ALIGNMENT_16K', 'libraries': libraries,
          'scope': 'Static bundle/ELF validation, not execution on a 16 KB device'}
Path(output).write_text(json.dumps(result, indent=2) + '\n')
print('PASS: signed bundle identity, API 36, 16 KB packaging and', len(libraries), 'ELF64 libraries')
