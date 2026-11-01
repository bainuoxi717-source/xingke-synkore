$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$compiler = Join-Path $projectRoot 'reproduction/host-tools/Lib/site-packages/ziglang/zig.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    throw 'Install ziglang in reproduction/host-tools first (Python 3.12 venv).'
}
Push-Location $projectRoot
try {
    & $compiler c++ -target x86_64-windows-gnu -std=c++17 -O2 -Wall -Wextra -I tests/host_stubs tests/uart_protocol_host_test.cpp firmware/classroom_recorder/uart_protocol.cpp -o reproduction/firmware/uart_protocol_host_test.exe *> reproduction/firmware/uart-host-build.log
    if ($LASTEXITCODE -ne 0) { throw 'UART host compilation failed; see uart-host-build.log' }
    & reproduction/firmware/uart_protocol_host_test.exe | Tee-Object reproduction/firmware/uart-host-result.txt
    if ($LASTEXITCODE -ne 0) { throw 'UART host tests failed' }
    & $compiler c++ -target x86_64-windows-gnu -std=c++17 -O2 -Wall -Wextra tests/sha256_host_test.cpp firmware/classroom_recorder/sha256.cpp -o reproduction/firmware/sha256_host_test.exe *> reproduction/firmware/sha-host-build.log
    if ($LASTEXITCODE -ne 0) { throw 'SHA256 host compilation failed; see sha-host-build.log' }
    & reproduction/firmware/sha256_host_test.exe | Tee-Object reproduction/firmware/sha-host-result.txt
    if ($LASTEXITCODE -ne 0) { throw 'SHA256 host tests failed' }
} finally {
    Pop-Location
}
