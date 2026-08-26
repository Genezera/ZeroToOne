@echo off
echo [%date% %time%] Iniciando scanner de bug bounty >> "C:\Users\Renan\ZeroToOne\logs\bugbounty-scanner.log"
"C:\Program Files\nodejs\node.exe" "C:\Users\Renan\ZeroToOne\system\bugbounty-scanner\scan-runner.mjs" >> "C:\Users\Renan\ZeroToOne\logs\bugbounty-scanner.log" 2>&1
