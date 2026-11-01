@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\pythonw.exe" (
  echo Python environment missing. Run the project setup first.
  pause
  exit /b 1
)
".venv\Scripts\pythonw.exe" tools\tf_card_import.py
endlocal
