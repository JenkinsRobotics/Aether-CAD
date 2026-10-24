#!/usr/bin/env python3
"""Restore checksum-pinned dependency archives from the local cache or a published URL."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import urllib.request


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def restore(root, cache):
    manifest = json.loads((root / 'vendor-manifest.json').read_text())
    for item in manifest['packages']:
        target = root / item['path']
        if not target.resolve().is_relative_to(root.resolve()):
            raise ValueError('Dependency path escapes the repository')
        expected = item['sha256']
        if len(expected) != 64 or any(c not in '0123456789abcdef' for c in expected):
            raise ValueError('Invalid dependency checksum')
        if target.is_file() and digest(target) == expected:
            print('Verified', item['path'])
            continue
        source = cache / (expected + '.tgz')
        if not source.is_file() and not item.get('url'):
            raise RuntimeError(f"Dependency {item['path']} is not remotely published yet. Supply its checksum-pinned archive in AETHER_PACKAGE_CACHE ({source}).")
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as output:
            temporary = Path(output.name)
            try:
                if source.is_file():
                    with source.open('rb') as incoming:
                        shutil.copyfileobj(incoming, output)
                else:
                    request = urllib.request.Request(item['url'], headers={'User-Agent': 'Aether-Package-Fetcher'})
                    with urllib.request.urlopen(request, timeout=120) as incoming:
                        shutil.copyfileobj(incoming, output)
                output.flush()
                if temporary.stat().st_size != item['bytes'] or digest(temporary) != expected:
                    raise RuntimeError('Dependency checksum or size mismatch: ' + item['path'])
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)
        print('Restored', item['path'])


if __name__ == '__main__':
    restore(Path(__file__).resolve().parents[1], Path(os.environ.get('AETHER_PACKAGE_CACHE', Path.home() / 'Library/Caches/Aether/packages')))
