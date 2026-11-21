' Abre Open Queue SIN dejar una ventana de consola abierta.
' La primera vez instala las dependencias en una ventana visible; después arranca en silencio.
Option Explicit
Dim sh, fso, dir, code
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

code = sh.Run("cmd /c where node >nul 2>nul", 0, True)
If code <> 0 Then
  MsgBox "Necesitas instalar Node.js LTS desde https://nodejs.org y volver a abrir este archivo.", 48, "Open Queue"
  WScript.Quit 1
End If

If Not fso.FolderExists(dir & "\node_modules") Then
  MsgBox "La primera vez se instalan unas dependencias (necesita internet). Se abrirá una ventana negra que se cierra sola al terminar.", 64, "Open Queue"
  code = sh.Run("cmd /c npm install", 1, True)
  If code <> 0 Then
    MsgBox "No se pudo instalar. Revisá tu conexión y probá de nuevo.", 48, "Open Queue"
    WScript.Quit 1
  End If
End If

' 0 = ventana oculta. El registro queda en open-queue.log por si algo falla.
sh.Run "cmd /c npm start > open-queue.log 2>&1", 0, False
