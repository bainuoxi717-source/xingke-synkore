param(
    [ValidateSet('Build', 'Flash', 'RestoreRecorder', 'RestorePet')][string]$Action = 'Build',
    [ValidateSet('ghost_companion', 'companion_recorder')][string]$Sketch = 'ghost_companion',
    [string]$Port = 'COM3',
    [int]$Baud = 460800,
    [string]$BuildRoot = (Join-Path $env:USERPROFILE 'zhiliu_t5_build')
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$prefix = if ($Sketch -eq 'companion_recorder') { 'dual' } else { 'ghost' }
$appName = if ($prefix -eq 'dual') { 'ZHILIU_DUAL_V1' } else { 'GHOST_T5_V1' }
$sourcePath = Join-Path $projectRoot "firmware/$Sketch"
$output = Join-Path $projectRoot "reproduction/$prefix/firmware"
$rollback = Join-Path $projectRoot 'reproduction/ghost/rollback'
$ghostBuild = Join-Path $BuildRoot "$prefix-build"
$binName = "$prefix-bin"
$ghostBin = Join-Path $BuildRoot $binName
$firmwareName = "$Sketch.ino_QIO.bin"
$manifestPath = Join-Path $output 'build-manifest.json'
if ($BuildRoot -match '[^\x00-\x7F]' -or $BuildRoot -match '\s') { throw 'BuildRoot must be an ASCII path without spaces.' }
if ($Port -notmatch '^COM[1-9][0-9]*$') { throw 'Port must be a Windows COM port, such as COM3.' }
New-Item -ItemType Directory -Path $output -Force | Out-Null

if ($Action -eq 'Build') {
    $data = Join-Path $BuildRoot 'arduino-data'
    if (-not (Test-Path (Join-Path $data 'packages/tuya_open/tools/vendor-T5/0.0.9'))) {
        & robocopy (Join-Path $projectRoot 'tools/arduino-data') $data /E /NFL /NDL /NJH /NJS /NP
        if ($LASTEXITCODE -ge 8) { throw 'Failed copying build dependencies.' }
    }
    $stage = Join-Path $BuildRoot $Sketch
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    # Delete nothing: abort on stale staging sources rather than silently compiling them.
    foreach ($file in @(Get-ChildItem -LiteralPath $stage -File)) {
        if (-not (Test-Path (Join-Path $sourcePath $file.Name))) { throw "Stale staged source: $($file.FullName)" }
    }
    Copy-Item -Path (Join-Path $sourcePath '*') -Destination $stage -Force
    $normalized = $BuildRoot.Replace('\', '/')
    $configuration = Join-Path $BuildRoot "$prefix-arduino-cli.yaml"
    @"
directories:
  data: $normalized/arduino-data
  downloads: $normalized/downloads
  user: $normalized/arduino-user
"@ | Set-Content -Encoding Ascii -LiteralPath $configuration
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $ErrorActionPreference = 'Continue'
    & (Join-Path $PSScriptRoot 'arduino-cli/arduino-cli.exe') --config-file $configuration compile --fqbn tuya_open:tuya_open:t5 --build-path $ghostBuild --output-dir $ghostBin $stage 2>&1 | Tee-Object -FilePath (Join-Path $output "compile-$stamp.log")
    $buildExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($buildExit -ne 0) { throw "$appName build failed with exit code $buildExit" }
    $firmware = Join-Path $ghostBin $firmwareName
    Copy-Item -LiteralPath $ghostBin -Destination $output -Recurse -Force
    $sourceHashes = @{}
    Get-ChildItem -LiteralPath $sourcePath -File | ForEach-Object {
        $stagedHash = (Get-FileHash -LiteralPath (Join-Path $stage $_.Name) -Algorithm SHA256).Hash
        if ((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash -ne $stagedHash) {
            throw "Source changed during build: $($_.Name). Rebuild before flashing."
        }
        $sourceHashes[$_.Name] = $stagedHash
    }
    @{
        app = $appName; fqbn = 'tuya_open:tuya_open:t5'; coreVersion = '1.2.5'; vendorVersion = '0.0.9'
        buildTime = (Get-Date -Format 'o'); sources = $sourceHashes
        qioSha256 = (Get-FileHash -LiteralPath $firmware -Algorithm SHA256).Hash
        bytes = (Get-Item -LiteralPath $firmware).Length
    } | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath $manifestPath
    Write-Host "$appName build complete: $output/$binName"
    exit 0
}

if ($Action -eq 'RestoreRecorder') {
    $firmware = Join-Path $rollback 'classroom_recorder.ino_QIO.bin'
    $expectedHash = 'EAD15EE6B47885E503868D80D7D1D5B3F916DAE7E6EE1C5965DB3BE6AD143821'
} elseif ($Action -eq 'RestorePet') {
    $firmware = Join-Path $projectRoot 'reproduction/dual/rollback/pet/ghost_companion.ino_QIO.bin'
    $expectedHash = '0530BBE3DCD3723A6F964AC69ECEB94C8674A65F16D2DA379A2905229D23FEB1'
} else {
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'Build the ghost firmware first.' }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $firmware = Join-Path (Join-Path $output $binName) $firmwareName
    $expectedHash = $manifest.qioSha256
    $current = @(Get-ChildItem -LiteralPath $sourcePath -File)
    if ($current.Count -ne @($manifest.sources.PSObject.Properties).Count) { throw 'Source set changed. Rebuild first.' }
    foreach ($file in $current) {
        if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne $manifest.sources.($file.Name)) {
            throw "Source changed: $($file.Name). Rebuild first."
        }
    }
}
if ((Get-FileHash -LiteralPath $firmware -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Firmware hash mismatch.' }
$flasher = Join-Path $BuildRoot 'arduino-data/packages/tuya_open/tools/tyutool/2.1.0/tyutool_cli.exe'
if (-not (Test-Path -LiteralPath $flasher)) { throw 'T5 flash tool missing.' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $output "$Action-$stamp.log"
"Action=$Action Port=$Port Baud=$Baud Firmware=$firmware SHA256=$expectedHash" | Set-Content -Encoding UTF8 -LiteralPath $log
$ErrorActionPreference = 'Continue'
& $flasher -n write -d T5 -p $Port -b $Baud -s 0x000000 -f $firmware --tqdm 2>&1 | Tee-Object -FilePath $log -Append
$flashExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
$result = Get-Content -LiteralPath $log -Raw -Encoding UTF8
if ($flashExit -ne 0 -or $result -match '\[ERROR\]|Flash write failed' -or
    $result -notmatch 'CRC check success' -or $result -notmatch 'Flash write success\.') {
    throw "Firmware upload did not pass write/CRC checks. See $log"
}
Write-Host "$Action succeeded. Log: $log"
