@echo off
echo [%date% %time%] Iniciando shadow market maker >> "C:\Users\Renan\ZeroToOne\logs\market-maker-shadow.log"
set MM_BASE_SPREAD_BPS=3
set MM_SNAPSHOT_INTERVAL_MS=120000
"C:\Program Files\nodejs\node.exe" "C:\Users\Renan\ZeroToOne\system\market-maker\shadow-runner.mjs" >> "C:\Users\Renan\ZeroToOne\logs\market-maker-shadow.log" 2>&1
