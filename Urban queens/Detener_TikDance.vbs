Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "taskkill /f /im node.exe", 0, True
MsgBox "TikDance y sus servicios han sido detenidos correctamente.", 64, "TikDance"
