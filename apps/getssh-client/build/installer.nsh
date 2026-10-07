!macro customHeader
  CRCCheck off
!macroend

!macro customInstall
  CreateDirectory "$SMPROGRAMS\GETSSH"
  CreateShortCut "$SMPROGRAMS\GETSSH\Uninstall GETSSH.lnk" "$INSTDIR\Uninstall GETSSH.exe"
!macroend

!macro customRemoveFiles
  Delete "$SMPROGRAMS\GETSSH\Uninstall GETSSH.lnk"
  RMDir "$SMPROGRAMS\GETSSH"
!macroend
