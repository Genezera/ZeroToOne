@echo off
echo [%date% %time%] Iniciando daily-runner >> "C:\Users\Renan\ZeroToOne\logs\daily-floor.log"
"C:\Program Files\nodejs\node.exe" "C:\Users\Renan\ZeroToOne\system\daily-floor\daily-runner.mjs" >> "C:\Users\Renan\ZeroToOne\logs\daily-floor.log" 2>&1
