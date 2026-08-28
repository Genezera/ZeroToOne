@echo off
echo [%date% %time%] Iniciando descoberta de alvo >> "C:\Users\Renan\ZeroToOne\logs\bugbounty-discovery.log"
"C:\Program Files\nodejs\node.exe" "C:\Users\Renan\ZeroToOne\system\bugbounty-scanner\discovery-runner.mjs" >> "C:\Users\Renan\ZeroToOne\logs\bugbounty-discovery.log" 2>&1
