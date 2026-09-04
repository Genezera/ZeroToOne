@echo off
setlocal
set "SCANNER_DIR=%~dp0"
for %%I in ("%SCANNER_DIR%..\..") do set "REPO_ROOT=%%~fI"
set "LOG_PATH=%REPO_ROOT%\logs\bugbounty-watchdog.log"
for %%A in ("%LOG_PATH%") do if %%~zA GTR 10485760 move /Y "%LOG_PATH%" "%LOG_PATH%.1" >nul
echo [%date% %time%] Watchdog ZeroToOne iniciado >> "%LOG_PATH%"
node "%SCANNER_DIR%watchdog-runner.mjs" >> "%LOG_PATH%" 2>&1
set "ZTO_EXIT=%ERRORLEVEL%"
echo [%date% %time%] Watchdog encerrado com codigo %ZTO_EXIT% >> "%LOG_PATH%"
exit /b %ZTO_EXIT%
