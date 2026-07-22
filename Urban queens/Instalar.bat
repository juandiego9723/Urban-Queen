@echo off
title Instalar TikDance
color 0A
echo ========================================================
echo   CONFIGURANDO TIKDANCE PARA ESTA COMPUTADORA...
echo ========================================================
echo.

set CURRENT_DIR=%~dp0
if "%CURRENT_DIR:~-1%"=="\" set CURRENT_DIR=%CURRENT_DIR:~0,-1%

echo [1/4] Generando icono oficial de Windows (app-icon.ico)...
powershell -ExecutionPolicy Bypass -File "%CURRENT_DIR%\generate_icon.ps1"

echo [2/4] Creando lanzador silencioso de servidor (Iniciar_TikDance.vbs)...
(
echo Set fso = CreateObject("Scripting.FileSystemObject"^)
echo currentDir = fso.GetParentFolderName(WScript.ScriptFullName^)
echo Set WshShell = CreateObject("WScript.Shell"^)
echo WshShell.CurrentDirectory = currentDir
echo WshShell.Run "node server.js", 0, False
echo WScript.Sleep 1500
echo WshShell.Run "cmd /c start http://localhost:3000/control", 0, False
) > "%CURRENT_DIR%\Iniciar_TikDance.vbs"

echo [3/4] Creando script de detencion limpia (Detener_TikDance.vbs)...
(
echo Set WshShell = CreateObject("WScript.Shell"^)
echo WshShell.Run "taskkill /f /im node.exe", 0, True
echo MsgBox "TikDance y sus servicios han sido detenidos correctamente.", 64, "TikDance"
) > "%CURRENT_DIR%\Detener_TikDance.vbs"

echo [4/4] Generando acceso directo "TikDance" con icono oficial en el Escritorio...
(
echo Set WshShell = CreateObject("WScript.Shell"^)
echo desktopPath = WshShell.SpecialFolders("Desktop"^)
echo shortcutPath = desktopPath ^& "\TikDance.lnk"
echo Set fso = CreateObject("Scripting.FileSystemObject"^)
echo If fso.FileExists(shortcutPath^) Then fso.DeleteFile(shortcutPath^)
echo Set shortcut = WshShell.CreateShortcut(shortcutPath^)
echo shortcut.TargetPath = "%CURRENT_DIR%\Iniciar_TikDance.vbs"
echo shortcut.WorkingDirectory = "%CURRENT_DIR%"
echo shortcut.IconLocation = "%CURRENT_DIR%\public\app-icon.ico,0"
echo shortcut.Description = "TikDance"
echo shortcut.Save
) > "%TEMP%\crear_acceso_tikdance.vbs"

cscript //nologo "%TEMP%\crear_acceso_tikdance.vbs"
if exist "%TEMP%\crear_acceso_tikdance.vbs" del "%TEMP%\crear_acceso_tikdance.vbs"

echo Actualizando cache de iconos de Windows...
ie4uinit.exe -show >nul 2>&1

echo.
echo ========================================================
echo   ¡CONFIGURACION COMPLETADA CON EXITO!
echo   Se ha creado el acceso directo "TikDance" con el logo
echo   oficial en tu Escritorio. Puedes iniciar el programa
echo   haciendo doble clic en el icono en cualquier momento.
echo ========================================================
echo.
pause
