@echo off
echo [%date% %time%] Iniciando scanner de bug bounty >> "E:\ZeroToOne\logs\bugbounty-scanner.log"
"C:\Program Files\nodejs\node.exe" "E:\ZeroToOne\system\bugbounty-scanner\scan-runner.mjs" >> "E:\ZeroToOne\logs\bugbounty-scanner.log" 2>&1
