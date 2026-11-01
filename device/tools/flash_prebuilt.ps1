param(
    [Parameter(Mandatory=$true)][ValidatePattern('^COM[1-9][0-9]*$')][string]$Port,
    [Parameter(Mandatory=$true)][string]$Flasher,
    [int]$Baud = 460800
)
$ErrorActionPreference = 'Stop'
$deviceRoot = Split-Path $PSScriptRoot -Parent
$image = Join-Path $deviceRoot 'prebuilt/companion_recorder.ino_QIO.bin'
$manifest = Get-Content -LiteralPath (Join-Path $deviceRoot 'prebuilt/build-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $image -Algorithm SHA256).Hash -ne $manifest.qioSha256) { throw 'Firmware SHA-256 mismatch.' }
if (-not (Test-Path -LiteralPath $Flasher -PathType Leaf)) { throw 'Official tyutool executable not found.' }
$logDir = Join-Path $deviceRoot 'reproduction/prebuilt-flash'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logPath = Join-Path $logDir ((Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
$ErrorActionPreference = 'Continue'
& $Flasher -n write -d T5 -p $Port -b $Baud -s 0x000000 -f $image --tqdm 2>&1 | Tee-Object -FilePath $logPath
$code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
$result = Get-Content -LiteralPath $logPath -Raw
if ($code -ne 0 -or $result -match '\[ERROR\]|Flash write failed' -or $result -notmatch 'CRC check success' -or $result -notmatch 'Flash write success\.') { throw "Flash verification failed; see $logPath" }
Write-Host 'Firmware written and CRC verified.'
