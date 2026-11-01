"""Install the T5-only subset of the official Tuya Arduino 1.2.5 package.

Each archive is SHA-256 verified against the untouched official Gitee index.
The omitted tools target ESP32, T2, T3, and LN882H; they are not used by T5.
"""
import concurrent.futures
import hashlib
import json
import pathlib
import subprocess
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
INDEX = json.loads((ROOT / 'reproduction/firmware/package_index_probe.json').read_text(encoding='utf-8-sig'))
PKG = INDEX['packages'][0]
CACHE = ROOT / 'tools/arduino-downloads/packages'
BASE = ROOT / 'tools/arduino-data/packages/tuya_open'
CACHE.mkdir(parents=True, exist_ok=True)
PLATFORM = next(p for p in PKG['platforms'] if p['version'] == '1.2.5')
WANTED = {'gcc-arm-none-eabi': '10.3', 'vendor-T5': '0.0.9', 'env-python': '3.12.4', 'tyutool': '2.1.0'}
JOBS = [(PLATFORM, BASE / 'hardware/tuya_open/1.2.5')]
for tool in PKG['tools']:
    if WANTED.get(tool['name']) == tool['version']:
        win = next(s for s in tool['systems'] if s['host'] == 'x86_64-cygwin')
        JOBS.append((win, BASE / 'tools' / tool['name'] / tool['version']))

def install(job):
    spec, dest = job
    archive = CACHE / spec['archiveFileName']
    expected = spec['checksum'].split(':', 1)[1].lower()
    if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        print('Downloading', archive.name, spec['size'], flush=True)
        with urllib.request.urlopen(spec['url'], timeout=120) as response, archive.open('wb') as out:
            while chunk := response.read(1024 * 1024):
                out.write(chunk)
    actual = hashlib.sha256(archive.read_bytes()).hexdigest()
    if actual != expected:
        raise RuntimeError(f'Checksum mismatch: {archive}')
    print('SHA256 verified', archive.name, actual, flush=True)
    dest.mkdir(parents=True, exist_ok=True)
    # Arduino archives each contain a single enclosing directory.
    subprocess.run(['tar', '-xf', str(archive), '-C', str(dest), '--strip-components', '1'], check=True)
    print('Installed', str(dest.relative_to(ROOT)), flush=True)
    return {'archive': archive.name, 'sha256': actual, 'destination': str(dest.relative_to(ROOT)), 'url': spec['url']}

with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    results = list(pool.map(install, JOBS))
(ROOT / 'reproduction/firmware/dependencies.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
