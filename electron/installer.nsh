; Script NSIS additionnel (electron-builder : build.directories.buildResources = electron).
;
; Claude Desktop lance le serveur MCP via NEXUS.exe : ce processus tourne depuis le
; dossier d'installation et Claude peut le relancer des qu'il est tue, ce qui bloquait
; la mise a jour (« NEXUS ne peut pas etre ferme »).
; On pose donc un fichier « pause » que le serveur MCP surveille : il s'arrete tout
; seul et refuse de redemarrer tant que la mise a jour n'est pas terminee.
; Garder le nom du fichier en phase avec MCP_PAUSE_FILE (mcp-server.cjs / main.cjs).

!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  FileOpen $0 "$LOCALAPPDATA\nexus-mcp-pause" w
  FileWrite $0 "update"
  FileClose $0
  ; le serveur MCP verifie le fichier chaque seconde
  Sleep 2500
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!macroend

!macro customInstall
  Delete "$LOCALAPPDATA\nexus-mcp-pause"
!macroend
