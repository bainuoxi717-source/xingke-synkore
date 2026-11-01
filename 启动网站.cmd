@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules call npm ci
if errorlevel 1 exit /b 1
call npm run seed
if errorlevel 1 exit /b 1
if not exist web\dist\index.html call npm run build
if errorlevel 1 exit /b 1
start "" http://localhost:3930
call npm start
