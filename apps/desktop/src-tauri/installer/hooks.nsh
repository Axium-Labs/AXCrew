; Native Windows installer API, scoped to the files being replaced.
; No subprocess, PowerShell payload, execution-policy override or name-wide kill.
!macro AX_CREW_RELEASE_INSTALLED_BINARIES
  ${If} ${FileExists} "$INSTDIR\bin\ax-crew.exe"
  ${OrIf} ${FileExists} "$INSTDIR\ax-crew-desktop.exe"
    System::Store "s"
    DetailPrint "Releasing AX Crew binaries with Windows Restart Manager..."
    System::Call 'rstrtmgr::RmStartSession(*i .r4, i 0, w .r5) i.r0'
    ${If} $0 == 0
      ; Own UTF-16 buffers and LPCWSTR[2] until registration completes.
      System::Call '*(&w${NSIS_MAX_STRLEN} "$INSTDIR\bin\ax-crew.exe") p.r1'
      System::Call '*(&w${NSIS_MAX_STRLEN} "$INSTDIR\ax-crew-desktop.exe") p.r2'
      System::Call '*(p r1, p r2) p.r3'
      StrCpy $0 14 ; ERROR_OUTOFMEMORY if an allocation failed.
      ${If} $1 P<> 0
      ${AndIf} $2 P<> 0
      ${AndIf} $3 P<> 0
        System::Call 'rstrtmgr::RmRegisterResources(i r4, i 2, p r3, i 0, p 0, i 0, p 0) i.r0'
        ${If} $0 == 0
          ; RmForceShutdown waits for exit, including legacy orphan gateways.
          System::Call 'rstrtmgr::RmShutdown(i r4, i 1, p 0) i.r0'
        ${EndIf}
      ${EndIf}
      System::Call 'rstrtmgr::RmEndSession(i r4)'
      System::Free $3
      System::Free $2
      System::Free $1
    ${EndIf}
    ${If} $0 != 0
      DetailPrint "Windows Restart Manager error: $0"
      MessageBox MB_OK|MB_ICONSTOP "Unable to release AX Crew files (Windows error $0). Close AX Crew and retry." /SD IDOK
      System::Store "l"
      Abort
    ${EndIf}
    System::Store "l"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro AX_CREW_RELEASE_INSTALLED_BINARIES
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro AX_CREW_RELEASE_INSTALLED_BINARIES
!macroend
