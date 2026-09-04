Set objShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
exitCode = objShell.Run("""" & fso.BuildPath(scriptDir, "run-service.cmd") & """", 0, True)
WScript.Quit exitCode
