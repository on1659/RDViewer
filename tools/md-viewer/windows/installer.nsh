; Per-user installation and file-open registration. Never write UserChoice or
; an extension's default value: Windows keeps the user's existing default app.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInstall
  WriteRegStr HKCU "Software\Classes\RDViewer.Markdown" "" "RDViewer Markdown Document"
  WriteRegStr HKCU "Software\Classes\RDViewer.Markdown\DefaultIcon" "" '$\"$INSTDIR\RDViewer.exe$\",0'
  WriteRegStr HKCU "Software\Classes\RDViewer.Markdown\shell\open\command" "" '$\"$INSTDIR\RDViewer.exe$\" $\"%1$\"'
  WriteRegStr HKCU "Software\RDViewer\Capabilities" "ApplicationName" "RDViewer"
  WriteRegStr HKCU "Software\RDViewer\Capabilities" "ApplicationDescription" "Local Markdown reader"
  !insertmacro RDViewerRegisterExtension ".md"
  !insertmacro RDViewerRegisterExtension ".markdown"
  !insertmacro RDViewerRegisterExtension ".mdown"
  WriteRegStr HKCU "Software\RegisteredApplications" "RDViewer" "Software\RDViewer\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro RDViewerRegisterExtension EXT
  WriteRegStr HKCU "Software\Classes\${EXT}\OpenWithProgids" "RDViewer.Markdown" ""
  WriteRegStr HKCU "Software\RDViewer\Capabilities\FileAssociations" "${EXT}" "RDViewer.Markdown"
!macroend

!macro customUnInstall
  ; Do not remove registration when uninstalling another copy installed later.
  ReadRegStr $R0 HKCU "Software\Classes\RDViewer.Markdown\shell\open\command" ""
  ${If} $R0 == '$\"$INSTDIR\RDViewer.exe$\" $\"%1$\"'
    DeleteRegKey HKCU "Software\Classes\RDViewer.Markdown"
    DeleteRegKey HKCU "Software\RDViewer\Capabilities"
    DeleteRegKey /ifempty HKCU "Software\RDViewer"
    DeleteRegValue HKCU "Software\RegisteredApplications" "RDViewer"
    DeleteRegValue HKCU "Software\Classes\.md\OpenWithProgids" "RDViewer.Markdown"
    DeleteRegValue HKCU "Software\Classes\.markdown\OpenWithProgids" "RDViewer.Markdown"
    DeleteRegValue HKCU "Software\Classes\.mdown\OpenWithProgids" "RDViewer.Markdown"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${EndIf}
!macroend
