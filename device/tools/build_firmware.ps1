param([string]$BuildRoot = (Join-Path $env:USERPROFILE 'zhiliu_t5_build'))
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if ($BuildRoot -match '[^\x00-\x7F]' -or $BuildRoot -match '\s') {
    throw 'The Tuya GCC toolchain requires an ASCII build path without spaces. Use -BuildRoot C:/zhiliu_t5_build.'
}
New-Item -ItemType Directory -Force -Path $BuildRoot | Out-Null
$dataSource = Join-Path $projectRoot 'tools/arduino-data'
if (-not (Test-Path (Join-Path $dataSource 'packages/tuya_open/tools/vendor-T5/0.0.9'))) {
    throw 'T5 dependencies missing. Restore them with reproduction/firmware/install_t5_dependencies.py first.'
}
& robocopy $dataSource (Join-Path $BuildRoot 'arduino-data') /E /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw 'Failed copying the build dependencies.' }
& robocopy (Join-Path $projectRoot 'firmware/classroom_recorder') (Join-Path $BuildRoot 'classroom_recorder') /E /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw 'Failed copying firmware sources.' }
$normalized = $BuildRoot.Replace('\', '/')
@"
board_manager:
  additional_urls:
    - https://gitee.com/tuya-open/arduino-tuyaopen/releases/download/global/package_tuya_open_index_cn.json
directories:
  data: $normalized/arduino-data
  downloads: $normalized/downloads
  user: $normalized/arduino-user
"@ | Set-Content -Encoding Ascii -LiteralPath (Join-Path $BuildRoot 'arduino-cli.yaml')
$output = Join-Path $projectRoot 'reproduction/firmware'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$ErrorActionPreference = 'Continue'
& (Join-Path $PSScriptRoot 'arduino-cli/arduino-cli.exe') --config-file (Join-Path $BuildRoot 'arduino-cli.yaml') compile --fqbn tuya_open:tuya_open:t5 --build-path (Join-Path $BuildRoot 'build') --output-dir (Join-Path $BuildRoot 'bin') (Join-Path $BuildRoot 'classroom_recorder') 2>&1 | Tee-Object -FilePath (Join-Path $output 'compile-final.log')
$buildExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($buildExit -ne 0) { throw "Firmware build failed with exit code $buildExit" }
Copy-Item -LiteralPath (Join-Path $BuildRoot 'bin') -Destination $output -Recurse -Force
Get-ChildItem -LiteralPath (Join-Path $output 'bin') -File | Get-FileHash -Algorithm SHA256 | Format-Table -AutoSize | Out-String | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $output 'firmware-sha256.txt')
$sourceHashes = @{}
Get-ChildItem -LiteralPath (Join-Path $BuildRoot 'classroom_recorder') -File | ForEach-Object {
    $sourceHashes[$_.Name] = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
}
$qio = Join-Path $BuildRoot 'bin/classroom_recorder.ino_QIO.bin'
@{
    fqbn = 'tuya_open:tuya_open:t5'
    coreVersion = '1.2.5'
    vendorVersion = '0.0.9'
    buildTime = (Get-Date -Format 'o')
    sources = $sourceHashes
    qioSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $qio).Hash
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $output 'build-manifest.json')
Write-Host "Build complete: $output/bin"
