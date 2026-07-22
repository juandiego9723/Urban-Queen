Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = currentDir
WshShell.Run "node server.js", 0, False
WScript.Sleep 1500
WshShell.Run "cmd /c start http://localhost:3000/control", 0, False
