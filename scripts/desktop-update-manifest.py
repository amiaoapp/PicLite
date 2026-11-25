"""Build the Tauri feed from the complete set of signed release packages."""
import base64
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

root = Path(sys.argv[1])
version = sys.argv[2]
if not re.fullmatch(r'\d+\.\d+\.\d+', version):
    raise SystemExit(f'Invalid desktop release version: {version}')
repo = os.environ['GITHUB_REPOSITORY']
packages = {}
for arch, windows, macos, linux in [('x86_64', 'x64', 'x64', 'amd64'),
                                      ('aarch64', 'arm64', 'aarch64', 'aarch64')]:
    packages.update({
        f'windows-{arch}-nsis': f'PicLite_{version}_{windows}-setup.exe',
        f'windows-{arch}-msi': f'PicLite_{version}_{windows}_en-US.msi',
        f'darwin-{arch}-app': f'PicLite_{version}_{macos}.app.tar.gz',
        f'linux-{arch}-appimage': f'PicLite_{version}_{linux}.AppImage',
    })

platforms = {}
with TemporaryDirectory() as temporary:
    public_key = Path(temporary) / 'updater.pub'
    public_key.write_bytes(base64.b64decode(os.environ['PICLITE_UPDATER_PUBLIC_KEY'].strip(), validate=True))
    decoded_signature = Path(temporary) / 'package.minisig'
    for target, name in packages.items():
        asset = root / name
        signature = (root / f'{name}.sig').read_text().strip()
        decoded_signature.write_bytes(base64.b64decode(signature, validate=True))
        subprocess.run(['minisign', '-Vq', '-p', str(public_key), '-m', str(asset),
                        '-x', str(decoded_signature)], check=True)
        platforms[target] = {
            'signature': signature,
            'url': f'https://github.com/{repo}/releases/download/v{version}/{name}',
        }

(root / 'latest.json').write_text(json.dumps({'version': version, 'platforms': platforms}, indent=2) + '\n')
