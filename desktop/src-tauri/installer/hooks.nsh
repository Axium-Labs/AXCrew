; Older desktop versions can leave the bundled gateway running after UI exit.
; Run for both upgrade and uninstall, before NSIS touches installed resources.
!include "${__FILEDIR__}\runtime-stop-command.nsh"

!macro AX_CREW_STOP_INSTALLED_RUNTIME
  ; Pass the directory as data, without interpolating it into PowerShell code.
  System::Call 'kernel32::SetEnvironmentVariableW(w "AX_CREW_INSTALL_DIR", w "$INSTDIR") i.r0'
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${AX_CREW_STOP_COMMAND}'
  Pop $0
  Pop $1
  System::Call 'kernel32::SetEnvironmentVariableW(w "AX_CREW_INSTALL_DIR", p 0)'
  DetailPrint "$1"
  ${If} $0 != "0"
    MessageBox MB_OK|MB_ICONSTOP "AX Crew could not release its installed binaries. Close AX Crew and retry."
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro AX_CREW_STOP_INSTALLED_RUNTIME
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro AX_CREW_STOP_INSTALLED_RUNTIME
!macroend
