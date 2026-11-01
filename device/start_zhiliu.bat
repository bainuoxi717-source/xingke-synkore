@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Python environment missing. Please install requirements in .venv first.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" launch_zhiliu.py %*
endlocal
