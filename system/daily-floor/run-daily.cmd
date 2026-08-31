@echo off
echo [%date% %time%] Iniciando daily-runner >> "E:\ZeroToOne\logs\daily-floor.log"
"C:\Program Files\nodejs\node.exe" "E:\ZeroToOne\system\daily-floor\daily-runner.mjs" >> "E:\ZeroToOne\logs\daily-floor.log" 2>&1
