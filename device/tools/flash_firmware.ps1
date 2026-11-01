param(
    [string]$Port = 'COM3',
    [int]$Baud = 921600,
    [string]$BuildRoot = (Join-Path $env:USERPROFILE 'zhiliu_t5_build')
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$flasher = Join-Path $BuildRoot 'arduino-data/packages/tuya_open/tools/tyutool/2.1.0/tyutool_cli.exe'
$firmware = Join-Path $BuildRoot 'bin/classroom_recorder.ino_QIO.bin'
if (-not (Test-Path -LiteralPath $flasher)) { throw 'Flasher missing. Run tools/build_firmware.ps1 first.' }
if (-not (Test-Path -LiteralPath $firmware)) { throw 'Firmware missing. Run tools/build_firmware.ps1 first.' }
if ($Port -notmatch '^COM[1-9][0-9]*$') { throw 'Port must be a Windows COM port such as COM3.' }
$output = Join-Path $projectRoot 'reproduction/firmware'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$manifestPath = Join-Path $output 'build-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'Build manifest missing. Rebuild with tools/build_firmware.ps1.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $firmware).Hash -ne $manifest.qioSha256) { throw 'Firmware differs from the verified build. Rebuild before flashing.' }
$currentFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'firmware/classroom_recorder') -File)
if ($currentFiles.Count -ne @($manifest.sources.PSObject.Properties).Count) { throw 'Firmware source set changed. Rebuild before flashing.' }
foreach ($source in $currentFiles) {
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $source.FullName).Hash -ne $manifest.sources.($source.Name)) {
        throw "Firmware source changed: $($source.Name). Rebuild before flashing."
    }
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $output "upload-$stamp.log"
"Port=$Port Baud=$Baud Firmware=$firmware" | Set-Content -Encoding UTF8 -LiteralPath $log
Get-FileHash -Algorithm SHA256 -LiteralPath $firmware | Format-List | Out-String | Add-Content -Encoding UTF8 -LiteralPath $log
$ErrorActionPreference = 'Continue'
& $flasher -n write -d T5 -p $Port -b $Baud -s 0x000000 -f $firmware --tqdm 2>&1 | Tee-Object -FilePath $log -Append
$uploadExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
"ExitCode=$uploadExit" | Add-Content -Encoding UTF8 -LiteralPath $log
if ($uploadExit -ne 0) { throw "Firmware upload failed with exit code $uploadExit. See $log" }
$uploadText = Get-Content -LiteralPath $log -Raw -Encoding UTF8
if ($uploadText -match '\[ERROR\]|Flash write failed' -or
    $uploadText -notmatch 'CRC check success' -or
    $uploadText -notmatch 'Flash write success\.') {
    throw "Firmware upload did not pass the tool's write/CRC checks. See $log"
}
Write-Host "Upload finished. Log: $log"
