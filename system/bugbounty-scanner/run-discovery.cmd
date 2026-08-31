@echo off
echo [%date% %time%] Iniciando descoberta de alvo >> "E:\ZeroToOne\logs\bugbounty-discovery.log"
"C:\Program Files\nodejs\node.exe" "E:\ZeroToOne\system\bugbounty-scanner\discovery-runner.mjs" >> "E:\ZeroToOne\logs\bugbounty-discovery.log" 2>&1
echo [%date% %time%] Iniciando digest de seguranca >> "E:\ZeroToOne\logs\bugbounty-discovery.log"
"C:\Program Files\nodejs\node.exe" "E:\ZeroToOne\system\bugbounty-scanner\digest-runner.mjs" >> "E:\ZeroToOne\logs\bugbounty-discovery.log" 2>&1
