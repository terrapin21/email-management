Dim objShell
Set objShell = CreateObject("WScript.Shell")

Dim fso
Set fso = CreateObject("Scripting.FileSystemObject")
Dim log
Set log = fso.OpenTextFile("C:\Users\PC\sync_log.txt", 8, True)
log.WriteLine Now & " START"

Dim r1
r1 = objShell.Run("robocopy ""\\192.168.1.195\disk1"" ""\\wsl$\Ubuntu\home\pc\nas_output"" /E /B /XO /R:3 /W:2", 0, True)
log.WriteLine Now & " STEP1 exitCode=" & r1

Dim r2
r2 = objShell.Run("robocopy ""\\wsl$\Ubuntu\home\pc\nas_output"" ""\\192.168.1.195\disk1"" /E /B /R:3 /W:2", 0, True)
log.WriteLine Now & " STEP2 exitCode=" & r2

log.WriteLine Now & " DONE"
log.Close
